import { useEffect, useState } from "react";
import { useAgent } from "agents/react";
import type { RakshakEvent, SessionSnapshot } from "../../shared/types";
import { EmptyHint, FamilyBadge, PipelinePanel, SeverityMeter, Shell, SnapshotMeta, StageTracker, TranscriptList } from "../components/ui";
import { applyEvent, emptySession, formatIST } from "../lib/store";

export default function RoomPage({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionSnapshot>(() => emptySession(sessionId));
  const [busy, setBusy] = useState(false);
  const agent = useAgent<SessionSnapshot>({ agent: "CallAgent", name: sessionId });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as RakshakEvent;
        if (parsed && typeof parsed === "object" && "type" in parsed && parsed.type !== "audio.speak") {
          setSession((prev) => applyEvent(prev, parsed));
        }
      } catch {
        // ignore
      }
    };
    agent.addEventListener("message", onMessage);
    agent.ready
      .then(() => agent.call<SessionSnapshot>("getSnapshot"))
      .then((snapshot) => setSession(snapshot))
      .catch(() => undefined);
    return () => agent.removeEventListener("message", onMessage);
  }, [agent]);

  const act = async (method: string) => {
    setBusy(true);
    try {
      const snapshot = await agent.call<SessionSnapshot>(method);
      if (snapshot) setSession(snapshot);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const currentRisk = session.riskEvents.at(-1);
  const alerts = [...session.alerts].reverse();

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__rakshakRoom = session;
  }, [session]);

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Family War Room</h1>
          <p className="mt-1 text-sm text-mist">Rohan's view · live session with Amma</p>
        </div>
        <SnapshotMeta session={session} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="flex flex-col gap-5">
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <FamilyBadge family={session.family} severity={session.peakSeverity} />
              <span className={`text-xs ${session.status === "live" ? "text-emerald-300" : "text-mist/60"}`}>
                ● {session.status}
              </span>
            </div>
            <div className="mt-4">
              <SeverityMeter severity={session.peakSeverity} peak />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-mist">
              {currentRisk
                ? `${currentRisk.stageName}: ${currentRisk.rationale}`
                : "Monitoring the call. No fraud pattern detected yet."}
            </p>
            <div className="mt-4">
              <StageTracker family={session.family} stageId={currentRisk?.stageId} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                disabled={busy}
                onClick={() => void act("sendWarning")}
                className="rounded-xl bg-red-500/90 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
              >
                ⚠ Send guardian warning
              </button>
              <button
                disabled={busy}
                onClick={() => void act(session.decoyActive ? "stopDecoy" : "startDecoy")}
                className="rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-amber-200 disabled:opacity-50"
              >
                {session.decoyActive ? "■ Stop counter-agent" : "🤖 Engage counter-agent"}
              </button>
              <a
                href="tel:+919999999999"
                className="rounded-xl border border-line bg-panel px-4 py-2.5 text-center text-sm text-emerald-100 transition hover:bg-panel-2"
              >
                📞 Call Amma now
              </a>
              <button
                disabled={busy}
                onClick={() => void act("endCall")}
                className="rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-red-200 transition hover:bg-panel-2 disabled:opacity-50"
              >
                ■ End call remotely
              </button>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">Family alerts</h2>
            {alerts.length === 0 && <EmptyHint>Alerts will appear here the moment risk crosses the threshold.</EmptyHint>}
            <div className="flex flex-col gap-2">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-xl border p-3 text-sm ${
                    alert.kind === "high_risk"
                      ? "border-red-400/40 bg-red-500/10 text-red-100"
                      : alert.kind === "recovery"
                        ? "border-amber-300/40 bg-amber-300/10 text-amber-100"
                        : "border-line bg-panel/60 text-mist"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] text-mist/60">
                    <span>{alert.kind}</span>
                    <span className="mono">{formatIST(alert.ts)}</span>
                  </div>
                  <div className="mt-1">{alert.message}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">
              Captured identifiers
            </h2>
            {session.identifiers.length === 0 && (
              <EmptyHint>Account numbers, UPI IDs and phone numbers spoken by the caller will be listed here.</EmptyHint>
            )}
            <div className="flex flex-col gap-2">
              {session.identifiers.map((identifier) => (
                <div key={identifier.id} className="flex items-center justify-between rounded-lg border border-line bg-panel/60 px-3 py-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-mist/50">{identifier.type}</div>
                    <div className="mono text-sm text-emerald-100">{identifier.value}</div>
                  </div>
                  <button
                    onClick={() => void navigator.clipboard.writeText(identifier.value)}
                    className="chip hover:bg-panel-2"
                  >
                    copy
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">Live call transcript</h2>
            <TranscriptList utterances={session.utterances} decoyActive={session.decoyActive} />
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">
              Audit trail · every model call, latency and fallback
            </h2>
            <PipelinePanel logs={session.pipeline} />
          </section>
          {session.interventions.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">Interventions</h2>
              <div className="flex flex-col gap-2">
                {session.interventions.map((intervention) => (
                  <div key={intervention.id} className="rounded-lg border border-line bg-panel/60 p-3 text-sm">
                    <div className="flex items-center justify-between text-[11px] text-mist/50">
                      <span>
                        {intervention.kind} · {intervention.triggeredBy}
                      </span>
                      <span className="mono">{formatIST(intervention.ts)}</span>
                    </div>
                    <div className="mt-1 text-emerald-50/90">{intervention.text}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}
