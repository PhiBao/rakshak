import { Agent, callable, getAgentByName } from "agents";
import type { Connection, WSMessage } from "agents";
import { WorkersAIFluxSTT, WorkersAINova3STT, withVoiceInput } from "agents/voice";
import type { Transcriber } from "agents/voice";
import { DeepgramSTT } from "@cloudflare/voice-deepgram";
import { speak } from "./ai/tts";
import { classify, ruleClassify, toRiskEvent } from "./ai/classifier";
import type { ClassifyResult } from "./ai/classifier";
import { generateDecoyLine } from "./ai/decoy";
import { extractIdentifiers } from "./ai/extract";
import { transcribePcm } from "./ai/transcribe";
import { buildEvidence } from "./evidence";
import type { Env } from "./env";
import { b64encode, newId } from "./utils";
import type {
  EvidenceBundle,
  Identifier,
  Intervention,
  PipelineLog,
  RiskEvent,
  RakshakEvent,
  ScamFamilyKey,
  SessionAlert,
  SessionSnapshot,
  Speaker,
  Utterance
} from "../shared/types";
import { scriptByKey } from "../shared/genome";

const InputAgent = withVoiceInput(Agent);

const KEYTERMS = [
  "CBI",
  "ED",
  "RBI",
  "digital arrest",
  "money laundering",
  "Aadhaar",
  "UPI",
  "OTP",
  "verification account",
  "customs",
  "narcotics",
  "safe custody",
  "Inspector",
  "Lakshmi Iyer",
  "verifycell",
  "okaxis",
  "HDFC"
];

interface Meta {
  status: "idle" | "live" | "ended";
  mode: "demo" | "live";
  language: "en" | "hi";
  stt: "flux" | "nova3";
  family?: ScamFamilyKey;
  peakSeverity: number;
  decoyActive: boolean;
  autoDecoy: boolean;
  warned: boolean;
  urgentAlerted: boolean;
  recoveryReady: boolean;
  contributed: boolean;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
}

const DEFAULT_META: Omit<Meta, "createdAt" | "updatedAt"> = {
  status: "idle",
  mode: "demo",
  language: "hi",
  stt: "flux",
  peakSeverity: 0,
  decoyActive: false,
  autoDecoy: true,
  warned: false,
  urgentAlerted: false,
  recoveryReady: false,
  contributed: false
};

const WARNINGS: Record<string, { hi: string; en: string }> = {
  digital_arrest: {
    hi: "रुकिए। यह डिजिटल अरेस्ट ठगी है। सीबीआई या पुलिस वीडियो कॉल पर गिरफ्तार नहीं करती। कोई पैसा, ओटीपी या पिन मत दीजिए। मैं आपके परिवार को अभी सूचित कर रहा हूँ।",
    en: "Stop. This is a digital arrest scam. The CBI or police never arrest people over a video call. Do not transfer money or share OTPs. I am alerting your family right now."
  },
  voice_clone_emergency: {
    hi: "रुकिए। यह आवाज़ नकली हो सकती है। फ़ोन काटिए और अपने बच्चे को उनके असली नंबर पर वापस कॉल कीजिए। कोई पैसा मत भेजिए।",
    en: "Stop. This voice may be cloned. Hang up and call your family member back on their saved number. Do not send money."
  },
  kyc_bank_fraud: {
    hi: "रुकिए। कोई बैंक कभी ओटीपी, पिन या सीवीवी नहीं मांगता। यह ठगी है। कृपया फ़ोन काटिए और मैं आपके परिवार को बता रहा हूँ।",
    en: "Stop. No bank ever asks for OTP, PIN or CVV. This is a fraud call. Hang up, and I am alerting your family."
  },
  tech_support: {
    hi: "रुकिए। यह टेक सपोर्ट ठगी है। कंपनियाँ कभी पैसे या रिमोट एक्सेस नहीं मांगतीं। फ़ोन काटिए।",
    en: "Stop. This is a tech-support scam. Companies never demand payment or remote access. Please hang up."
  },
  lottery_prize: {
    hi: "रुकिए। कोई इनाम पाने के लिए पहले पैसे नहीं देने पड़ते। यह ठगी है। कोई फ़ीस मत भेजिए।",
    en: "Stop. Genuine prizes never require an advance fee. This is a scam. Do not pay anything."
  },
  unknown: {
    hi: "सावधान रहें। यह कॉल संदिग्ध लग रही है। कृपया कोई पैसा या ओटीपी साझा न करें।",
    en: "Please be careful. This call looks suspicious. Do not share money or OTPs."
  }
};
export class CallAgent extends InputAgent<Env> {
  #meta: Meta | null = null;
  #initialized = false;
  #classifying = false;
  #dirty = false;
  #decoyBusy = false;
  #lastDecoyUtteranceId: string | null = null;
  #recentTexts: string[] = [];
  #lastUtterance = "";

  get sessionId(): string {
    return this.ctx.id.name ?? "default";
  }

  createTranscriber(_connection: Connection): Transcriber {
    const meta = this.#loadMeta();
    if (this.env.DEEPGRAM_API_KEY) {
      return new DeepgramSTT({
        apiKey: this.env.DEEPGRAM_API_KEY,
        model: "nova-3",
        language: meta.language === "hi" ? "hi" : "en",
        smartFormat: false,
        punctuate: true,
        endpointingMs: 300
      });
    }
    if (meta.stt === "nova3") {
      return new WorkersAINova3STT(this.env.AI, {
        language: meta.language === "hi" ? "hi" : "en",
        keyterms: KEYTERMS,
        endpointingMs: 300,
        utteranceEndMs: 1200
      });
    }
    return new WorkersAIFluxSTT(this.env.AI, {
      keyterms: KEYTERMS,
      eotThreshold: 0.6,
      eotTimeoutMs: 3000
    });
  }

  async onStart(): Promise<void> {
    this.#ensureSchema();
  }

  onConnect(connection: Connection): void {
    this.#ensureSchema();
    this.#send(connection, { type: "session.snapshot", session: this.#snapshot() });
  }

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    this.#ensureSchema();
    if (typeof message !== "string") return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = payload.type;
    if (type === "session.start") {
      const language = payload.language === "en" ? "en" : "hi";
      const mode = payload.mode === "live" ? "live" : "demo";
      const autoDecoy = payload.autoDecoy !== false;
      this.#updateMeta({ language, mode, autoDecoy, status: "live", updatedAt: Date.now() });
      this.#send(connection, { type: "session.snapshot", session: this.#snapshot() });
      return;
    }
    if (type === "action") {
      const action = String(payload.action ?? "");
      void this.#handleAction(action, connection, payload);
      return;
    }
    if (type === "audio.chunk") {
      const base64 = String(payload.pcm ?? "");
      if (base64.length > 100) {
        void this.#handleAudioChunk(base64, connection);
      }
      return;
    }
    if (type === "demo.ended") {
      // Give pending utterances a window to finalise before building evidence.
      this.#log("policy", "ok", "session", 0, "demo audio complete; flushing transcript before finalising");
      await this.schedule(22, "finalizeSession", { reason: "demo_complete" });
      return;
    }
    if (type === "feedback") {
      const label = String(payload.label ?? "unknown");
      this.#log("policy", "ok", `feedback:${label}`, 0, "Human feedback recorded");
      void this.#applyFeedback(label);
    }
  }

  async onTranscript(text: string, connection: Connection): Promise<void> {
    void connection;
    await this.#ingestUtterance(text, 0.92);
  }

  async #ingestUtterance(text: string, confidence: number): Promise<void> {
    this.#ensureSchema();
    const clean = text.trim();
    if (clean.length < 2) return;
    if (clean === this.#lastUtterance) return;
    if (this.#isNearDuplicate(clean)) return;
    this.#lastUtterance = clean;
    this.#recentTexts.push(clean);
    if (this.#recentTexts.length > 4) this.#recentTexts.shift();
    const meta = this.#loadMeta();
    const utterance: Utterance = {
      id: newId("u"),
      sessionId: this.sessionId,
      speaker: "unknown",
      text: clean,
      ts: Date.now(),
      confidence,
      final: true
    };
    this.#insertUtterance(utterance);
    if (meta.status === "idle") this.#updateMeta({ status: "live" });
    this.#emit({ type: "transcript.final", utterance });

    const windowed = this.#recentUtterances(3).map((u) => u.text).join(" ");
    const found = [...extractIdentifiers(this.sessionId, clean), ...extractIdentifiers(this.sessionId, windowed)];
    const seen = new Set<string>();
    for (const identifier of found) {
      const key = `${identifier.type}:${identifier.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = [...this.sql`SELECT id FROM identifiers WHERE type = ${identifier.type} AND value = ${identifier.value} LIMIT 1`] as Array<{ id: string }>;
      if (existing.length > 0) continue;
      this.#insertIdentifier(identifier);
      this.#emit({ type: "identifier.found", identifier });
    }

    void this.#scheduleClassify();
  }

  #isNearDuplicate(text: string): boolean {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const candidate = normalize(text);
    if (candidate.length < 12) return false;
    for (const previous of this.#recentTexts) {
      const prior = normalize(previous);
      if (!prior) continue;
      if (prior === candidate) return true;
      if (prior.includes(candidate) || candidate.includes(prior)) return true;
      const priorTokens = new Set(prior.split(" "));
      const tokens = candidate.split(" ");
      const overlap = tokens.filter((token) => priorTokens.has(token)).length / Math.max(1, tokens.length);
      if (overlap > 0.85) return true;
    }
    return false;
  }

  async #handleAudioChunk(base64: string, connection: Connection): Promise<void> {
    void connection;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const started = Date.now();
      const result = await transcribePcm(this.env, bytes, this.#loadMeta().language);
      this.#log("stt", result.fallback ? "fallback" : "ok", result.model, Date.now() - started, `batch ${(bytes.length / 32000).toFixed(1)}s audio`);
      await this.#ingestUtterance(result.text, 0.85);
    } catch (error) {
      this.#log(
        "stt",
        "error",
        "whisper",
        0,
        `batch transcription failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ---------------- Callable API (family war room) ----------------

  @callable()
  getSnapshot(): SessionSnapshot {
    this.#ensureSchema();
    return this.#snapshot();
  }

  @callable()
  async sendWarning(): Promise<SessionSnapshot> {
    await this.#issueWarning("guardian_manual", "guardian");
    return this.#snapshot();
  }

  @callable()
  async endCall(): Promise<SessionSnapshot> {
    await this.#finishSession("guardian_ended");
    return this.#snapshot();
  }

  @callable()
  async startDecoy(): Promise<SessionSnapshot> {    this.#updateMeta({ decoyActive: true });
    this.#emit({ type: "decoy.update", active: true });
    this.#recordIntervention("decoy_start", "guardian", "Counter-agent engaged to stall the caller and capture payment identifiers.");
    await this.#raiseAlert("intervention", "Decoy engaged — the scammer is now talking to Rakshak's counter-agent.");
    return this.#snapshot();
  }

  @callable()
  async stopDecoy(): Promise<SessionSnapshot> {
    this.#updateMeta({ decoyActive: false });
    this.#emit({ type: "decoy.update", active: false });
    this.#recordIntervention("decoy_stop", "guardian", "Counter-agent stopped.");
    return this.#snapshot();
  }

  @callable()
  getEvidence(): EvidenceBundle {
    this.#ensureSchema();
    return buildEvidence(this.#evidenceInput());
  }

  async finalizeSession(payload?: { reason?: string }): Promise<void> {
    await this.#finishSession(payload?.reason ?? "scheduled_finalize");
  }

  // ---------------- Internals ----------------

  #ensureSchema(): void {
    if (this.#initialized) return;
    this.sql`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS utterances (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        speaker TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL,
        confidence REAL NOT NULL,
        final INTEGER NOT NULL
      );
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS risk_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        family TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        stage_name TEXT NOT NULL,
        severity REAL NOT NULL,
        tactics TEXT NOT NULL,
        rationale TEXT NOT NULL,
        quotes TEXT NOT NULL,
        latest_speaker TEXT NOT NULL,
        model TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        fallback INTEGER NOT NULL
      );
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS interventions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        text TEXT NOT NULL
      );
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        channel TEXT NOT NULL,
        message TEXT NOT NULL,
        acknowledged INTEGER NOT NULL
      );
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS identifiers (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        display TEXT NOT NULL
      );
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS pipeline (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT,
        latency_ms INTEGER,
        detail TEXT
      );
    `;
    this.#initialized = true;
  }

  #loadMeta(): Meta {
    this.#ensureSchema();
    if (this.#meta) return this.#meta;
    const rows = [...this.sql`SELECT value FROM meta WHERE key = 'state'`] as Array<{ value: string }>;
    if (rows.length > 0 && rows[0]?.value) {
      try {
        this.#meta = { ...DEFAULT_META, ...(JSON.parse(rows[0].value) as Partial<Meta>) } as Meta;
        return this.#meta;
      } catch {
        // fall through to defaults
      }
    }
    const now = Date.now();
    this.#meta = { ...DEFAULT_META, createdAt: now, updatedAt: now };
    this.#persistMeta();
    return this.#meta;
  }

  #updateMeta(patch: Partial<Meta>): void {
    const meta = this.#loadMeta();
    this.#meta = { ...meta, ...patch, updatedAt: Date.now() };
    this.#persistMeta();
  }

  #persistMeta(): void {
    if (!this.#meta) return;
    const value = JSON.stringify(this.#meta);
    this.sql`INSERT INTO meta (key, value) VALUES ('state', ${value})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
  }

  #insertUtterance(utterance: Utterance): void {
    this.sql`INSERT INTO utterances (id, session_id, speaker, text, ts, confidence, final)
      VALUES (${utterance.id}, ${utterance.sessionId}, ${utterance.speaker}, ${utterance.text}, ${utterance.ts}, ${utterance.confidence}, 1)`;
  }

  #updateSpeaker(id: string, speaker: Speaker): void {
    this.sql`UPDATE utterances SET speaker = ${speaker} WHERE id = ${id}`;
  }

  #insertRisk(risk: RiskEvent): void {
    this.sql`INSERT INTO risk_events (id, session_id, ts, family, stage_id, stage_name, severity, tactics, rationale, quotes, latest_speaker, model, latency_ms, fallback)
      VALUES (${risk.id}, ${risk.sessionId}, ${risk.ts}, ${risk.family}, ${risk.stageId}, ${risk.stageName}, ${risk.severity}, ${JSON.stringify(risk.tactics)}, ${risk.rationale}, ${JSON.stringify(risk.quotes)}, ${risk.latestSpeaker}, ${risk.model}, ${risk.latencyMs}, ${risk.fallback ? 1 : 0})`;
  }

  #recordIntervention(kind: Intervention["kind"], triggeredBy: Intervention["triggeredBy"], text: string): Intervention {
    const intervention: Intervention = {
      id: newId("iv"),
      sessionId: this.sessionId,
      ts: Date.now(),
      kind,
      triggeredBy,
      text
    };
    this.sql`INSERT INTO interventions (id, session_id, ts, kind, triggered_by, text)
      VALUES (${intervention.id}, ${intervention.sessionId}, ${intervention.ts}, ${intervention.kind}, ${intervention.triggeredBy}, ${intervention.text})`;
    return intervention;
  }

  #insertIdentifier(identifier: Identifier): void {
    this.sql`INSERT INTO identifiers (id, session_id, ts, type, value, display)
      VALUES (${identifier.id}, ${identifier.sessionId}, ${identifier.ts}, ${identifier.type}, ${identifier.value}, ${identifier.display})`;
  }

  #log(
    kind: PipelineLog["kind"],
    status: PipelineLog["status"],
    model: string,
    latencyMs: number,
    detail: string
  ): PipelineLog {
    const log: PipelineLog = {
      id: newId("log"),
      sessionId: this.sessionId,
      ts: Date.now(),
      kind,
      status,
      model,
      latencyMs,
      detail
    };
    this.sql`INSERT INTO pipeline (id, session_id, ts, kind, status, model, latency_ms, detail)
      VALUES (${log.id}, ${log.sessionId}, ${log.ts}, ${log.kind}, ${log.status}, ${log.model ?? null}, ${log.latencyMs ?? null}, ${log.detail ?? null})`;
    this.#emit({ type: "pipeline.log", log });
    return log;
  }

  #emit(event: RakshakEvent): void {
    this.broadcast(JSON.stringify(event));
  }

  #send(connection: Connection, event: RakshakEvent): void {
    try {
      connection.send(JSON.stringify(event));
    } catch {
      // connection closed
    }
  }

  #recentUtterances(limit: number): Utterance[] {
    const rows = [...this.sql`SELECT * FROM utterances ORDER BY ts DESC LIMIT ${limit}`] as Array<Record<string, unknown>>;
    return rows
      .map((row) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        speaker: String(row.speaker) as Speaker,
        text: String(row.text),
        ts: Number(row.ts),
        confidence: Number(row.confidence),
        final: true
      }))
      .reverse();
  }

  async #scheduleClassify(): Promise<void> {
    if (this.#classifying) {
      this.#dirty = true;
      return;
    }
    this.#classifying = true;
    try {
      do {
        this.#dirty = false;
        await this.#classifyOnce();
      } while (this.#dirty);
    } finally {
      this.#classifying = false;
    }
  }

  async #classifyOnce(): Promise<void> {
    const meta = this.#loadMeta();
    const utterances = this.#recentUtterances(16);
    if (utterances.length === 0) return;
    const latest = utterances[utterances.length - 1]!;

    let result: ClassifyResult;
    try {
      result = await classify(this.env, utterances, {
        family: meta.family,
        stageId: undefined,
        peak: meta.peakSeverity
      });
    } catch (error) {
      this.#log(
        "classify",
        "error",
        "featherless",
        0,
        `classifier failed: ${error instanceof Error ? error.message : String(error)}`
      );
      result = ruleClassify(utterances);
    }

    if (utterances.length < 2 && result.severity < 40) return;

    const peak = Math.max(meta.peakSeverity, result.severity);
    const risk = toRiskEvent(this.sessionId, result, latest, peak);
    this.#insertRisk(risk);

    if (result.latestSpeaker !== "unknown" && latest.speaker !== result.latestSpeaker) {
      this.#updateSpeaker(latest.id, result.latestSpeaker);
      this.#emit({
        type: "transcript.final",
        utterance: { ...latest, speaker: result.latestSpeaker }
      });
    }

    this.#log(
      "classify",
      result.fallback ? "fallback" : "ok",
      result.model,
      result.latencyMs,
      `${result.family}/${result.stageId} severity=${result.severity}`
    );

    if (result.family !== "unknown") {
      this.#updateMeta({ family: result.family, peakSeverity: peak });
    } else {
      this.#updateMeta({ peakSeverity: peak });
    }

    this.#emit({ type: "risk.update", risk, peakSeverity: peak });

    await this.#applyPolicy(result, peak);

    if (this.#loadMeta().decoyActive && result.family !== "unknown") {
      void this.#decoyTurn(result);
    }
  }

  async #applyPolicy(result: ClassifyResult, peak: number): Promise<void> {
    const meta = this.#loadMeta();
    if (meta.status === "ended") return;

    if (!meta.warned && peak >= 55 && result.family !== "unknown" && (result.stageId !== "pretext_authority" || peak >= 65)) {
      await this.#issueWarning("auto", "system");
    }

    if (!meta.urgentAlerted && peak >= 80) {
      this.#updateMeta({ urgentAlerted: true });
      await this.#raiseAlert("high_risk", "HIGH RISK: caller is pushing the victim toward a payment. Family action needed now.");
    }

    if (meta.autoDecoy && !meta.decoyActive && peak >= 78 && result.family === "digital_arrest" && meta.mode === "demo") {
      this.#updateMeta({ decoyActive: true });
      this.#emit({ type: "decoy.update", active: true });
      this.#recordIntervention(
        "decoy_start",
        "system",
        "Rakshak engaged the counter-agent automatically to stall the scammer and capture payment identifiers."
      );
      await this.#raiseAlert("intervention", "Counter-agent engaged automatically — the scammer is now being stalled.");
    }

    if (!meta.recoveryReady && peak >= 92) {
      void this.#prepareRecovery("high_risk_during_call");
    }
  }

  async #issueWarning(reason: string, triggeredBy: Intervention["triggeredBy"]): Promise<void> {
    const meta = this.#loadMeta();
    if (meta.warned && reason === "auto") return;
    this.#updateMeta({ warned: true });
    const family = meta.family ?? "unknown";
    const template = WARNINGS[family] ?? WARNINGS.unknown!;
    const text = meta.language === "hi" ? template.hi : template.en;
    const subtitle = meta.language === "hi" ? template.en : template.hi;

    const intervention = this.#recordIntervention("warn", triggeredBy, `${text} (${subtitle})`);
    this.#emit({ type: "intervention.warning", intervention, severity: meta.peakSeverity });

    try {
      const speech = await speak(this.env, text, "guardian", meta.language);
      this.#emit({
        type: "audio.speak",
        role: "guardian",
        text,
        audio: b64encode(speech.audio),
        format: speech.format
      });
      this.#log("tts", speech.fallback ? "fallback" : "ok", speech.model, speech.latencyMs, `guardian voice (${speech.voice})`);
    } catch {
      this.#log("tts", "error", "none", 0, "Guardian voice failed; falling back to on-screen warning");
    }

    await this.#raiseAlert("scam_detected", `Scam detected: ${scriptByKey(family)?.name ?? "suspected fraud"}. Guardian warning delivered.`);
    void this.#contributeGenome(this.#loadMeta().family);
  }

  async #decoyTurn(result: ClassifyResult): Promise<void> {
    if (this.#decoyBusy) return;
    const latest = this.#recentUtterances(1)[0];
    if (!latest || latest.speaker === "decoy" || latest.speaker === "guardian") return;
    if (latest.id === this.#lastDecoyUtteranceId) return;
    this.#decoyBusy = true;
    this.#lastDecoyUtteranceId = latest.id;
    try {
      const transcript = this.#recentUtterances(12)
        .map((u) => `${u.speaker}: ${u.text}`)
        .join("\n");
      const turn = await generateDecoyLine(this.env, transcript, result.stageName);
      const meta = this.#loadMeta();
      const utterance: Utterance = {
        id: newId("u"),
        sessionId: this.sessionId,
        speaker: "decoy",
        text: turn.line,
        ts: Date.now(),
        confidence: 1,
        final: true
      };
      this.#insertUtterance(utterance);
      this.#emit({ type: "transcript.final", utterance });
      this.#log("classify", turn.fallback ? "fallback" : "ok", turn.model, turn.latencyMs, `decoy ask=${turn.ask}`);

      try {
        const speech = await speak(this.env, turn.line, "decoy", meta.language);
        this.#emit({
          type: "audio.speak",
          role: "decoy",
          text: turn.line,
          audio: b64encode(speech.audio),
          format: speech.format
        });
        this.#log("tts", speech.fallback ? "fallback" : "ok", speech.model, speech.latencyMs, `decoy voice (${speech.voice})`);
      } catch {
        this.#log("tts", "error", "none", 0, "Decoy voice failed");
      }

      const found = extractIdentifiers(this.sessionId, turn.line);
      for (const identifier of found) {
        this.#insertIdentifier(identifier);
        this.#emit({ type: "identifier.found", identifier });
      }
    } finally {
      this.#decoyBusy = false;
    }
  }

  async #raiseAlert(kind: SessionAlert["kind"], message: string): Promise<void> {
    const alert: SessionAlert = {
      id: newId("al"),
      sessionId: this.sessionId,
      ts: Date.now(),
      kind,
      channel: "war_room",
      message,
      acknowledged: false
    };
    this.sql`INSERT INTO alerts (id, session_id, ts, kind, channel, message, acknowledged)
      VALUES (${alert.id}, ${alert.sessionId}, ${alert.ts}, ${alert.kind}, ${alert.channel}, ${alert.message}, 0)`;
    this.#emit({ type: "alert.sent", alert });
  }

  async #handleAction(action: string, connection: Connection, payload: Record<string, unknown>): Promise<void> {
    switch (action) {
      case "warn":
        await this.#issueWarning("guardian_manual", "guardian");
        break;
      case "notify":
        await this.#raiseAlert("intervention", String(payload.message ?? "Family has been notified."));
        break;
      case "decoy_start":
        await this.startDecoy();
        break;
      case "decoy_stop":
        await this.stopDecoy();
        break;
      case "end_session":
        await this.#finishSession("guardian_ended");
        break;
      case "remote_end": {
        this.#recordIntervention("remote_end", "guardian", "Call ended remotely by a family guardian.");
        await this.#raiseAlert("intervention", "A family guardian ended the call remotely.");
        await this.#finishSession("guardian_ended");
        break;
      }
      default:
        void connection;
        break;
    }
  }

  async #finishSession(reason: string): Promise<void> {
    const meta = this.#loadMeta();
    if (meta.status === "ended") return;
    this.#updateMeta({ status: "ended", decoyActive: false, endedAt: Date.now() });
    this.#emit({ type: "decoy.update", active: false });
    this.#emit({ type: "session.ended", endedAt: Date.now() });
    this.#log("policy", "ok", "session", 0, `session ended: ${reason}`);
    await this.#prepareRecovery(reason);
    void this.#contributeGenome(meta.family);
  }

  async #prepareRecovery(reason: string): Promise<void> {
    const meta = this.#loadMeta();
    if (meta.recoveryReady) return;
    this.#updateMeta({ recoveryReady: true });
    const evidence = this.getEvidence();
    this.#log("policy", "ok", "evidence", 0, `evidence bundle generated: ${reason}`);
    this.#emit({
      type: "recovery.ready",
      evidenceUrl: `/evidence/${this.sessionId}`,
      complaintDraft: evidence.complaintDraft
    });
    await this.#raiseAlert("recovery", "Golden-hour recovery pack is ready: complaint draft, identifiers and the 1930 runbook.");
  }

  async #contributeGenome(family?: ScamFamilyKey): Promise<void> {
    const meta = this.#loadMeta();
    if (!family || family === "unknown" || meta.contributed) return;
    this.#updateMeta({ contributed: true });
    try {
      const stub = await getAgentByName<Env, import("./genome-agent").GenomeAgent>(
        this.env.GenomeAgent,
        "global"
      );
      const identRows = [...this.sql`SELECT type, value FROM identifiers`] as Array<{ type: string; value: string }>;
      const latestRisk = [...this.sql`SELECT stage_id FROM risk_events ORDER BY ts DESC LIMIT 1`] as Array<{ stage_id: string }>;
      const summary = await stub.record({
        scriptKey: family,
        stageId: latestRisk[0]?.stage_id,
        identifiers: identRows.map((row) => ({ type: row.type, value: row.value })),
        sessionId: this.sessionId
      });
      this.#emit({ type: "genome.updated", scriptKey: family, callCount: summary.callCount });
      this.#log("genome", "ok", "genome-agent", 0, `contributed ${family}; total ${summary.callCount}`);
    } catch {
      this.#log("genome", "error", "genome-agent", 0, "genome contribution failed");
    }
  }

  async #applyFeedback(label: string): Promise<void> {
    if (label === "false_positive") {
      this.#updateMeta({ peakSeverity: Math.max(0, this.#loadMeta().peakSeverity - 40) });
      this.#log("policy", "ok", "feedback", 0, "Session marked as false positive; severity lowered.");
    }
  }

  #snapshot(): SessionSnapshot {
    const meta = this.#loadMeta();
    const utteranceRows = [...this.sql`SELECT * FROM utterances ORDER BY ts ASC`] as Array<Record<string, unknown>>;
    const riskRows = [...this.sql`SELECT * FROM risk_events ORDER BY ts ASC`] as Array<Record<string, unknown>>;
    const interventionRows = [...this.sql`SELECT * FROM interventions ORDER BY ts ASC`] as Array<Record<string, unknown>>;
    const alertRows = [...this.sql`SELECT * FROM alerts ORDER BY ts ASC`] as Array<Record<string, unknown>>;
    const identifierRows = [...this.sql`SELECT * FROM identifiers ORDER BY ts ASC`] as Array<Record<string, unknown>>;
    const pipelineRows = [...this.sql`SELECT * FROM pipeline ORDER BY ts ASC LIMIT 200`] as Array<Record<string, unknown>>;

    return {
      sessionId: this.sessionId,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      status: meta.status,
      mode: meta.mode,
      language: meta.language,
      family: meta.family,
      peakSeverity: meta.peakSeverity,
      decoyActive: meta.decoyActive,
      utterances: utteranceRows.map((row) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        speaker: String(row.speaker) as Speaker,
        text: String(row.text),
        ts: Number(row.ts),
        confidence: Number(row.confidence),
        final: Boolean(row.final)
      })),
      riskEvents: riskRows.map(
        (row): RiskEvent => ({
          id: String(row.id),
          sessionId: String(row.session_id),
          ts: Number(row.ts),
          family: String(row.family) as ScamFamilyKey,
          stageId: String(row.stage_id),
          stageName: String(row.stage_name),
          severity: Number(row.severity),
          tactics: safeArray(row.tactics),
          rationale: String(row.rationale),
          quotes: safeArray(row.quotes),
          latestSpeaker: String(row.latest_speaker) as Speaker,
          model: String(row.model),
          latencyMs: Number(row.latency_ms),
          fallback: Boolean(row.fallback)
        })
      ),
      interventions: interventionRows.map(
        (row): Intervention => ({
          id: String(row.id),
          sessionId: String(row.session_id),
          ts: Number(row.ts),
          kind: String(row.kind) as Intervention["kind"],
          triggeredBy: String(row.triggered_by) as Intervention["triggeredBy"],
          text: String(row.text)
        })
      ),
      alerts: alertRows.map(
        (row): SessionAlert => ({
          id: String(row.id),
          sessionId: String(row.session_id),
          ts: Number(row.ts),
          kind: String(row.kind) as SessionAlert["kind"],
          channel: String(row.channel) as SessionAlert["channel"],
          message: String(row.message),
          acknowledged: Boolean(row.acknowledged)
        })
      ),
      identifiers: identifierRows.map(
        (row): Identifier => ({
          id: String(row.id),
          sessionId: String(row.session_id),
          ts: Number(row.ts),
          type: String(row.type) as Identifier["type"],
          value: String(row.value),
          display: String(row.display)
        })
      ),
      pipeline: pipelineRows.map(
        (row): PipelineLog => ({
          id: String(row.id),
          sessionId: String(row.session_id),
          ts: Number(row.ts),
          kind: String(row.kind) as PipelineLog["kind"],
          status: String(row.status) as PipelineLog["status"],
          model: row.model ? String(row.model) : undefined,
          latencyMs: row.latency_ms === null || row.latency_ms === undefined ? undefined : Number(row.latency_ms),
          detail: row.detail ? String(row.detail) : undefined
        })
      )
    };
  }

  #evidenceInput() {
    const snapshot = this.#snapshot();
    return {
      sessionId: snapshot.sessionId,
      peakSeverity: snapshot.peakSeverity,
      family: snapshot.family,
      utterances: snapshot.utterances,
      riskEvents: snapshot.riskEvents,
      interventions: snapshot.interventions,
      alerts: snapshot.alerts,
      identifiers: snapshot.identifiers
    };
  }
}

function safeArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
