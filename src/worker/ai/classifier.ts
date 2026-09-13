import { z } from "zod";
import { GENOME_SEED } from "../../shared/genome";
import type { RiskEvent, ScamFamilyKey, Speaker, Utterance } from "../../shared/types";
import { chat } from "./featherless";
import type { Env } from "../env";
import { clamp, newId, parseJsonLoose } from "../utils";

const HIGH_SIGNAL: Record<string, string[]> = {
  digital_arrest: [
    "digital arrest",
    "cbi",
    "enforcement directorate",
    "money laundering",
    "do not tell",
    "don't tell",
    "don't tell anyone",
    "video call",
    "verification account",
    "safe custody",
    "secret supervision",
    "arrest warrant",
    "aadhaar misuse",
    "narcotics",
    "customs"
  ],
  voice_clone_emergency: [
    "accident",
    "kidnap",
    "hospital",
    "surgery",
    "send money",
    "scan this qr",
    "don't call back",
    "phone is broken",
    "in police custody"
  ],
  kyc_bank_fraud: ["kyc", "otp", "cvv", "blocked", "anydesk", "teamviewer", "suspicious transaction", "card will be frozen"],
  tech_support: ["microsoft", "virus", "hacked", "teamviewer", "anydesk", "gift card", "remote access"],
  lottery_prize: ["lottery", "kbc", "prize", "processing fee", "lucky draw", "token amount"]
};

const BENIGN_MARKERS = [
  "appointment",
  "checkup",
  "wedding",
  "train",
  "tablet",
  "lunch",
  "passbook",
  "branch",
  "renew",
  "reports",
  "insurance card"
];

const RiskSchema = z.object({
  family: z.string(),
  stage_id: z.string(),
  stage_name: z.string(),
  severity: z.coerce.number(),
  tactics: z.array(z.string()).optional(),
  rationale: z.string().optional(),
  quotes: z.array(z.string()).optional(),
  latest_speaker: z.string().optional()
});

export interface ClassifyResult {
  family: ScamFamilyKey;
  stageId: string;
  stageName: string;
  severity: number;
  tactics: string[];
  rationale: string;
  quotes: string[];
  latestSpeaker: Speaker;
  model: string;
  latencyMs: number;
  fallback: boolean;
}

function compactGenome() {
  return GENOME_SEED.map((script) => ({
    key: script.key,
    name: script.name,
    stages: script.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      description: stage.description,
      indicators: stage.indicators
    }))
  }));
}

function buildPrompt(utterances: Utterance[], previous: { family?: ScamFamilyKey; stageId?: string; peak: number }) {
  const transcript = utterances
    .map((u, i) => `${i + 1}. [${u.speaker}] ${u.text}`)
    .join("\n");
  const system = [
    "You are Rakshak, a fraud-script analyst for live phone calls in India.",
    "Classify the conversation into the closest known scam family and stage. Use only the stage definitions provided.",
    "Judge the script and social-engineering tactics, not just keywords. Digital arrest is common: authority pretext, false accusation, isolation, video surveillance, fund verification, extraction.",
    "If the conversation looks like a normal family, hospital, bank or service call, return family 'unknown', stage_id 'none', severity under 15.",
    "Return ONLY a JSON object with these exact keys: family, stage_id, stage_name, severity, tactics, rationale, quotes, latest_speaker.",
    "Keep it terse: rationale under 25 words; tactics at most 4 items; quotes at most 2 short exact spans (under 12 words each).",
    "severity is 0-100 for the current risk that the victim loses money or credentials.",
    "The audio stream mixes both speakers, so infer who is speaking: threats, instructions, official-sounding authority and payment demands are the CALLER (scammer); confusion, fear, questions, compliance and personal details are the VICTIM. latest_speaker is the most likely speaker of the most recent line and must be exactly 'caller' or 'victim'."
  ].join(" ");
  const user = [
    `KNOWN SCAM SCRIPTS:\n${JSON.stringify(compactGenome())}`,
    `PREVIOUS STATE: family=${previous.family ?? "unknown"} stage=${previous.stageId ?? "none"} peak_severity=${previous.peak}`,
    `LIVE TRANSCRIPT (oldest to newest):\n${transcript}`,
    "Return the JSON for the current state of this call."
  ].join("\n\n");
  return { system, user };
}

const SEVERITY_WORDS: Record<string, number> = {
  none: 0,
  low: 25,
  minor: 20,
  medium: 55,
  moderate: 50,
  high: 80,
  severe: 85,
  critical: 95
};

const FAMILY_ALIASES: Array<{ match: RegExp; key: ScamFamilyKey }> = [
  { match: /digital|arrest|authority|government|police|cbi|law.?enforcement|impersonat/i, key: "digital_arrest" },
  { match: /voice|clone|family.?emergency|kidnap|grandparent/i, key: "voice_clone_emergency" },
  { match: /kyc|bank|card|otp|account|phish/i, key: "kyc_bank_fraud" },
  { match: /tech|support|virus|microsoft|remote/i, key: "tech_support" },
  { match: /lottery|prize|scheme|fee|subsidy/i, key: "lottery_prize" }
];

function normalizeSeverity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered in SEVERITY_WORDS) return SEVERITY_WORDS[lowered]!;
    const parsed = Number(lowered.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function normalize(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const outer = raw as Record<string, unknown>;
  const nestedCandidates = [outer.analysis, outer.result, outer.data, outer.output, outer.classification];
  const nested = nestedCandidates.find((value) => value && typeof value === "object") as Record<string, unknown> | undefined;
  const source = nested ?? outer;
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }
    return undefined;
  };
  const familyRaw = String(pick("family", "family_key", "familyKey", "scam_family", "scamFamily") ?? "unknown");
  let family: ScamFamilyKey = normalizeFamily(familyRaw);
  if (family === "unknown" && familyRaw !== "unknown" && familyRaw !== "none") {
    const alias = FAMILY_ALIASES.find((entry) => entry.match.test(familyRaw));
    if (alias) family = alias.key;
  }
  const stageIdRaw = pick("stage_id", "stageId", "stage", "stage_key", "stageKey");
  const stageName = String(pick("stage_name", "stageName", "stage_label", "stageLabel") ?? "");
  return {
    family,
    stage_id: stageIdRaw === undefined ? "none" : String(stageIdRaw),
    stage_name: stageName,
    severity: normalizeSeverity(pick("severity", "severity_score", "severityScore", "risk", "risk_score", "score")),
    tactics: pick("tactics", "tactic", "signals") ?? [],
    rationale: pick("rationale", "reason", "explanation", "analysis") ?? "",
    quotes: pick("quotes", "quote", "evidence", "spans") ?? [],
    latest_speaker: pick("latest_speaker", "latestSpeaker", "speaker", "last_speaker") ?? "unknown"
  };
}

function resolveStage(family: ScamFamilyKey, stageId: string, stageName: string): { id: string; name: string } {
  const script = GENOME_SEED.find((entry) => entry.key === family);
  if (!script) return { id: "none", name: stageName || "None" };
  const byId = script.stages.find((stage) => stage.id === stageId);
  if (byId) return { id: byId.id, name: byId.name };
  const lowered = stageName.toLowerCase();
  const byName = script.stages.find(
    (stage) => lowered.length > 3 && (lowered.includes(stage.name.toLowerCase()) || stage.name.toLowerCase().includes(lowered))
  );
  if (byName) return { id: byName.id, name: byName.name };
  const numeric = Number(stageId);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= script.stages.length) {
    const stage = script.stages[Math.floor(numeric) - 1]!;
    return { id: stage.id, name: stage.name };
  }
  const fallback = script.stages.at(-1)!;
  return { id: fallback.id, name: fallback.name };
}

export async function classify(
  env: Env,
  utterances: Utterance[],
  previous: { family?: ScamFamilyKey; stageId?: string; peak: number }
): Promise<ClassifyResult> {
  const { system, user } = buildPrompt(utterances, previous);
  const result = await chat(env, { system, user, model: "fast", json: true, maxTokens: 800, temperature: 0 });
  const parsed = parseJsonLoose<unknown>(result.text);
  const validated = RiskSchema.safeParse(normalize(parsed));
  if (!validated.success) {
    throw new Error(`invalid JSON from model: ${result.text.replace(/\s+/g, " ").slice(0, 260)}`);
  }
  const data = validated.data;
  const family = normalizeFamily(String(data.family));
  const stage = resolveStage(family, String(data.stage_id ?? "none"), String(data.stage_name ?? ""));
  return {
    family,
    stageId: stage.id,
    stageName: stage.name || data.stage_name || "Suspected fraud",
    severity: clamp(Math.round(normalizeSeverity(data.severity)), 0, 100),
    tactics: (data.tactics ?? []).slice(0, 6),
    rationale: data.rationale ?? "",
    quotes: (data.quotes ?? []).slice(0, 4),
    latestSpeaker: normalizeSpeaker(data.latest_speaker),
    model: result.model,
    latencyMs: result.latencyMs,
    fallback: result.fallback
  };
}

export function ruleClassify(utterances: Utterance[]): ClassifyResult {
  const started = Date.now();
  const text = utterances.map((u) => u.text).join(" ").toLowerCase();
  const scores: Record<string, number> = {};
  const stageScores: Record<string, Record<string, number>> = {};

  for (const script of GENOME_SEED) {
    let score = 0;
    stageScores[script.key] = {};
    for (const stage of script.stages) {
      let stageScore = 0;
      for (const indicator of stage.indicators) {
        if (text.includes(indicator.toLowerCase())) {
          stageScore += 1;
          score += 1;
        }
      }
      stageScores[script.key]![stage.id] = stageScore;
    }
    for (const hi of HIGH_SIGNAL[script.key] ?? []) {
      if (text.includes(hi)) {
        score += 2;
        const stage = script.stages.find((s) => s.indicators.some((i) => i.toLowerCase().includes(hi) || hi.includes(i.toLowerCase())));
        if (stage) stageScores[script.key]![stage.id] = (stageScores[script.key]![stage.id] ?? 0) + 2;
      }
    }
    scores[script.key] = score;
  }

  const benignHits = BENIGN_MARKERS.filter((m) => text.includes(m)).length;

  let bestFamily: ScamFamilyKey = "unknown";
  let bestScore = 0;
  for (const [key, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestFamily = key as ScamFamilyKey;
    }
  }

  if (bestScore === 0 || (benignHits > 0 && bestScore < 4)) {
    return {
      family: "unknown",
      stageId: "none",
      stageName: "No fraud pattern",
      severity: benignHits > 0 ? 4 : 8,
      tactics: [],
      rationale: benignHits > 0 ? "Conversation matches a routine service or family call." : "No known fraud indicators detected yet.",
      quotes: [],
      latestSpeaker: normalizeSpeaker(utterances.at(-1)?.speaker),
      model: "rules",
      latencyMs: Date.now() - started,
      fallback: true
    };
  }

  const stages = stageScores[bestFamily] ?? {};
  const script = GENOME_SEED.find((s) => s.key === bestFamily);
  let bestStageId = "none";
  let bestStageScore = 0;
  let deepestIndex = -1;
  if (script) {
    for (let index = 0; index < script.stages.length; index += 1) {
      const stage = script.stages[index]!;
      const score = stages[stage.id] ?? 0;
      if (score > bestStageScore) bestStageScore = score;
      if (score > 0 && index > deepestIndex) {
        deepestIndex = index;
        bestStageId = stage.id;
      }
    }
  }
  const stage = script?.stages.find((s) => s.id === bestStageId);
  const depthBonus = deepestIndex > 0 ? deepestIndex * 6 : 0;
  const severity = clamp(18 + bestScore * 7 + depthBonus - benignHits * 6, 0, 94);

  return {
    family: bestFamily,
    stageId: bestStageId,
    stageName: stage?.name ?? "Suspected fraud",
    severity,
    tactics: HIGH_SIGNAL[bestFamily]?.filter((h) => text.includes(h)).slice(0, 5) ?? [],
    rationale: `Rule engine matched ${bestScore} indicators for ${script?.name ?? bestFamily} (deepest stage: ${stage?.name ?? "unknown"}).`,
    quotes: [],
    latestSpeaker: normalizeSpeaker(utterances.at(-1)?.speaker),
    model: "rules",
    latencyMs: Date.now() - started,
    fallback: true
  };
}

function normalizeFamily(value: string): ScamFamilyKey {
  const known = GENOME_SEED.map((s) => s.key) as string[];
  return known.includes(value) ? (value as ScamFamilyKey) : "unknown";
}

function normalizeSpeaker(value?: string): Speaker {
  if (value === "caller" || value === "victim" || value === "decoy" || value === "guardian") return value;
  return "unknown";
}

export function toRiskEvent(
  sessionId: string,
  result: ClassifyResult,
  latest: Utterance | undefined,
  peakSeverity: number
): RiskEvent {
  return {
    id: newId("risk"),
    sessionId,
    ts: Date.now(),
    family: result.family,
    stageId: result.stageId,
    stageName: result.stageName,
    severity: peakSeverity,
    tactics: result.tactics,
    rationale: result.rationale,
    quotes: result.quotes,
    latestSpeaker: latest?.speaker ?? result.latestSpeaker,
    model: result.model,
    latencyMs: result.latencyMs,
    fallback: result.fallback
  };
}
