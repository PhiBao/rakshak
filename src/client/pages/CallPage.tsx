import { useEffect, useMemo, useRef, useState } from "react";
import { VoiceClient } from "@cloudflare/voice/client";
import type { Intervention, RakshakEvent, SessionSnapshot } from "../../shared/types";
import { FamilyBadge, Icon, PipelinePanel, SeverityMeter, Shell, SnapshotMeta, StageTracker, TranscriptList } from "../components/ui";
import { SpeechController } from "../lib/audio-controller";
import { FileAudioInput } from "../lib/file-audio-input";
import { RecordingMix } from "../lib/recording-mix";
import { applyEvent, emptySession } from "../lib/store";
import { navigate } from "../lib/router";

type Mode = "idle" | "demo" | "mic";

export default function CallPage({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionSnapshot>(() => emptySession(sessionId));
  const [interim, setInterim] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [running, setRunning] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<Intervention | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState<"hi" | "en">("hi");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const clientRef = useRef<VoiceClient | null>(null);
  const agentRef = useRef<{ send: (data: string) => void; close: () => void } | null>(null);
  const inputRef = useRef<FileAudioInput | null>(null);
  const speechRef = useRef<SpeechController>(new SpeechController());
  const cleanupRef = useRef<Array<() => void>>([]);
  const retryRef = useRef(0);

  const currentRisk = session.riskEvents.at(-1);
  const highRisk = session.peakSeverity >= 55;

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__rakshak = session;
  }, [session]);

  useEffect(() => {
    return () => {
      for (const off of cleanupRef.current) off();
      clientRef.current?.endCall();
      clientRef.current?.disconnect();
      agentRef.current?.close();
      inputRef.current?.stop();
      speechRef.current.stop();
    };
  }, []);

  useEffect(() => {
    if (running === "idle") return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const handleEvent = useMemo(
    () =>
      (raw: unknown): void => {
        let event: RakshakEvent;
        try {
          event = typeof raw === "string" ? (JSON.parse(raw) as RakshakEvent) : (raw as RakshakEvent);
        } catch {
          return;
        }
        if (!event || typeof event !== "object" || !("type" in event)) return;
        setSession((prev) => applyEvent(prev, event));
        switch (event.type) {
          case "audio.speak":
            speechRef.current.enqueue({ role: event.role, audio: event.audio, format: event.format, text: event.text });
            break;
          case "intervention.warning":
            setWarning(event.intervention);
            break;
          case "recovery.ready":
            setEvidenceUrl(event.evidenceUrl);
            break;
          case "session.ended":
            cleanupRef.current.forEach((off) => off());
            cleanupRef.current = [];
            inputRef.current?.stop();
            setRunning("idle");
            break;
          default:
            break;
        }
      },
    []
  );

  const sendAction = (payload: Record<string, unknown>) => {
    if (clientRef.current) clientRef.current.sendJSON(payload);
    else if (agentRef.current) agentRef.current.send(JSON.stringify(payload));
  };

  const exposeDebugHooks = () => {
    const w = window as unknown as Record<string, unknown>;
    w.__rakshakStartDecoy = () => sendAction({ type: "action", action: "decoy_start" });
    w.__rakshakEndCall = () => sendAction({ type: "action", action: "end_session" });
    w.__rakshakAudio = () => {
      const audio = inputRef.current?.audio;
      return audio
        ? { currentTime: audio.currentTime, duration: audio.duration, paused: audio.paused, ended: audio.ended, volume: audio.volume }
        : null;
    };
  };

  const start = async (mode: Mode) => {
    if (running !== "idle") return;
    setError(null);
    setWarning(null);
    setEvidenceUrl(null);
    setElapsed(0);
    setProgress(0);
    try {
      const params = new URLSearchParams(window.location.search);
      const shouldRecord = params.get("record") === "1";
      const mix = shouldRecord ? new RecordingMix() : null;
      if (mix) {
        await mix.resume();
        speechRef.current.attachMix(mix);
        (window as unknown as Record<string, unknown>).__rakshakRecordStartedAt = Date.now();
        (window as unknown as Record<string, unknown>).__rakshakRecording = {
          stop: async () => {
            const blob = await mix.stop();
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            }
            return { base64: btoa(binary), type: blob.type };
          }
        };
      }

      const speed = Number(params.get("speed") ?? "0.8") || 0.8;
      const steps: string[] = [];
      (window as unknown as Record<string, unknown>).__rakshakSteps = steps;
      const step = (label: string) => {
        steps.push(`${new Date().toISOString().slice(11, 19)} ${label}`);
      };

      if (mode === "demo") {
        // Recorded-call demo path: batch transcription over a plain agent socket.
        const { AgentClient } = await import("agents/client");
        const agent = new AgentClient({ agent: "CallAgent", name: sessionId, host: window.location.host });
        agentRef.current = agent;
        cleanupRef.current = [];
        step("connecting (batch)");
        await agent.ready;
        step("connected");
        const onMessage = (event: MessageEvent) => handleEvent(event.data);
        agent.addEventListener("message", onMessage);
        cleanupRef.current.push(() => agent.removeEventListener("message", onMessage));
        agent.send(JSON.stringify({ type: "session.start", mode, language, autoDecoy: true }));

        const input = new FileAudioInput("/demo/call-digital-arrest.mp3", {
          speed,
          ...(mix ? { mix } : {}),
          batch: {
            chunkSeconds: 8,
            onChunk: (pcm) => agent.send(JSON.stringify({ type: "audio.chunk", pcm: base64FromBytes(pcm) }))
          }
        });
        inputRef.current = input;
        speechRef.current.attach(input);
        input.onProgress = (fraction) => setProgress(fraction);
        input.onEnded = () => agent.send(JSON.stringify({ type: "demo.ended" }));
        await input.start();
        step("streaming demo audio");
        exposeDebugHooks();
        setRunning("demo");
        return;
      }

      // Live microphone path: streaming STT through the voice pipeline.
      const client = new VoiceClient({ agent: "CallAgent", name: sessionId });
      clientRef.current = client;
      cleanupRef.current = [];

      const add = (event: string, handler: (data: never) => void) => {
        client.addEventListener(event as never, handler as never);
        cleanupRef.current.push(() => client.removeEventListener(event as never, handler as never));
      };
      add("custommessage", (data: unknown) => handleEvent(data));
      add("interimtranscript", (text: string | null) => setInterim(text));
      add("statuschange", (value: string) => setStatus(value));
      add("error", (message: string | null) => setError(message));
      add("voiceerror", (value: { message?: string; retryable?: boolean }) => {
        setError(value?.message ?? "voice pipeline error");
        const attempt = retryRef.current + 1;
        if (attempt <= 3) {
          retryRef.current = attempt;
          window.setTimeout(async () => {
            try {
              client.endCall();
              await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
              await client.startCall();
              setError(`reconnected to speech recognition (attempt ${attempt})`);
            } catch {
              setError("speech recognition reconnect failed");
            }
          }, 600);
        }
      });

      step("connecting");
      client.connect();
      for (let i = 0; i < 80 && !client.connected; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      step(`connected=${client.connected}`);
      step("starting call");
      await client.startCall();
      mix?.start();
      step("call started");
      client.sendJSON({ type: "session.start", mode, language, autoDecoy: true });
      exposeDebugHooks();
      step("session.start sent");
      setRunning("mic");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not start the call";
      (window as unknown as Record<string, unknown>).__rakshakStartError = message;
      console.error("[rakshak] start failed", cause);
      setError(message);
      setRunning("idle");
    }
  };

  const end = () => {
    sendAction({ type: "action", action: "end_session" });
    setTimeout(() => {
      inputRef.current?.stop();
      clientRef.current?.endCall();
      clientRef.current?.disconnect();
      setRunning("idle");
    }, 900);
  };

  const feedback = (label: "scam" | "false_positive") => {
    sendAction({ type: "feedback", label });
  };

  return (
    <Shell active="demo">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Parent Shield</h1>
          <p className="mt-1 text-sm text-mist">Amma's phone · live protection</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setLanguage((value) => (value === "hi" ? "en" : "hi"))}
            className="chip hover:bg-panel-2"
            disabled={running !== "idle"}
          >
            {language === "hi" ? "हिंदी + English" : "English"}
          </button>
          <a
            href={`/room/${sessionId}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-line bg-panel px-4 py-2 text-sm text-emerald-100 transition hover:bg-panel-2"
          >
            Open family war room ↗
          </a>
          {evidenceUrl && (
            <button
              onClick={() => navigate(evidenceUrl)}
              className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-amber-200"
            >
              Golden-hour recovery pack →
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="card relative overflow-hidden p-6">
          {highRisk && <div className="pulse-ring pointer-events-none absolute inset-0 rounded-2xl" />}
          <div className="flex items-center justify-between">
            <FamilyBadge family={session.family} severity={session.peakSeverity} />
            <span className="text-xs text-mist/60">
              {running === "idle" ? "standby" : status} · {formatElapsed(elapsed)}
            </span>
          </div>

          <div className="mt-5" data-testid="severity">
            <SeverityMeter severity={session.peakSeverity} peak />
            {session.alerts.some((alert) => alert.kind === "scam_detected") && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                <Icon name="check" /> Family alerted in the war room
              </div>
            )}
            {currentRisk && (
              <p className="mt-2 text-sm leading-relaxed text-mist">
                <span className="font-semibold text-emerald-100">{currentRisk.stageName}:</span> {currentRisk.rationale}
              </p>
            )}
          </div>

          <div className="mt-4">
            <StageTracker family={session.family} stageId={currentRisk?.stageId} />
          </div>

          {running === "demo" && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-[11px] text-mist/60">
                <span>call recording progress</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full bg-emerald-400/70" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {running === "idle" ? (
              <>
                <button
                  onClick={() => void start("demo")}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-ink shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
                >
                  <Icon name="play" /> Play the scam call (live pipeline)
                </button>
                <button
                  onClick={() => void start("mic")}
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-5 py-3 text-sm text-emerald-100 transition hover:bg-panel-2"
                >
                  <Icon name="mic" /> Use microphone (role-play the scammer)
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={end}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-400/40 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20"
                >
                  <Icon name="stop" /> End call & build recovery pack
                </button>
                <button
                  onClick={() => feedback("false_positive")}
                  className="rounded-xl border border-line bg-panel px-4 py-3 text-xs text-mist transition hover:bg-panel-2"
                >
                  This was not a scam
                </button>
              </>
            )}
          </div>

          {error && <p className="mt-3 text-xs text-red-300">{error}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="chip">STT · Whisper (batch) · Flux (live)</span>
            <span className="chip">Reasoning · Featherless {session.riskEvents.at(-1)?.model ?? "DeepSeek-V4-Flash"}</span>
            <span className="chip">Voice · Featherless Kokoro</span>
          </div>
        </section>

        <section className="flex flex-col gap-5">
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-mist/70">Live transcript</h2>
              <SnapshotMeta session={session} />
            </div>
            <TranscriptList utterances={session.utterances} interim={interim} decoyActive={session.decoyActive} />
          </div>

          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">What the model sees</h2>
            <PipelinePanel logs={session.pipeline} />
          </div>
        </section>
      </div>

      {warning && (
        <div
          data-testid="stop-card"
          className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-red-400/70 bg-gradient-to-t from-red-950 via-ink to-ink/95 p-5 shadow-2xl"
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-2">
            <div className="flex items-center gap-3">
              <Logo />
              <div>
                <div className="text-lg font-bold tracking-tight text-red-200">STOP — do not pay, do not share OTP</div>
                <div className="text-xs text-mist/70">Rakshak guardian warning · your family has been alerted</div>
              </div>
              <button
                onClick={() => setWarning(null)}
                className="ml-auto rounded-lg border border-line px-3 py-1 text-xs text-mist hover:bg-panel-2"
              >
                Dismiss
              </button>
            </div>
            <p className="text-base font-medium leading-relaxed text-emerald-50">{warning.text}</p>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Logo() {
  return (
    <svg width={38} height={38} viewBox="0 0 32 32" aria-hidden>
      <path fill="#f87171" d="M16 2 4 7v9c0 7.2 5.1 12.3 12 14 6.9-1.7 12-6.8 12-14V7L16 2Z" />
      <path fill="#04110d" d="M15 9h2v9h-2zM15 21h2v2h-2z" />
    </svg>
  );
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
