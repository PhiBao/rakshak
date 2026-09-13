import type { RakshakEvent, SessionSnapshot } from "../../shared/types";

export function emptySession(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    mode: "demo",
    language: "hi",
    peakSeverity: 0,
    decoyActive: false,
    utterances: [],
    riskEvents: [],
    interventions: [],
    alerts: [],
    identifiers: [],
    pipeline: []
  };
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [...list, item];
  const copy = list.slice();
  copy[index] = item;
  return copy;
}

export function applyEvent(session: SessionSnapshot, event: RakshakEvent): SessionSnapshot {
  switch (event.type) {
    case "session.snapshot":
      return event.session;
    case "transcript.final": {
      const exists = session.utterances.some((u) => u.id === event.utterance.id);
      return {
        ...session,
        updatedAt: Date.now(),
        status: session.status === "idle" ? "live" : session.status,
        utterances: exists ? upsertById(session.utterances, event.utterance) : [...session.utterances, event.utterance]
      };
    }
    case "risk.update":
      return {
        ...session,
        updatedAt: Date.now(),
        family: event.risk.family,
        peakSeverity: event.peakSeverity,
        riskEvents: upsertById(session.riskEvents, event.risk)
      };
    case "intervention.warning":
      return { ...session, updatedAt: Date.now(), interventions: upsertById(session.interventions, event.intervention) };
    case "alert.sent":
      return { ...session, updatedAt: Date.now(), alerts: upsertById(session.alerts, event.alert) };
    case "identifier.found":
      return { ...session, updatedAt: Date.now(), identifiers: upsertById(session.identifiers, event.identifier) };
    case "identifier.removed":
      return { ...session, updatedAt: Date.now(), identifiers: session.identifiers.filter((entry) => entry.id !== event.id) };
    case "decoy.update":
      return { ...session, updatedAt: Date.now(), decoyActive: event.active };
    case "pipeline.log":
      return { ...session, updatedAt: Date.now(), pipeline: [...session.pipeline, event.log].slice(-250) };
    case "session.ended":
      return { ...session, status: "ended", decoyActive: false, updatedAt: Date.now() };
    case "recovery.ready":
    case "genome.updated":
    case "audio.speak":
      return session;
    default:
      return session;
  }
}

export function riskColor(severity: number): string {
  if (severity >= 80) return "#f87171";
  if (severity >= 55) return "#fbbf24";
  if (severity >= 30) return "#facc15";
  return "#34d399";
}

export function formatIST(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function speakerLabel(speaker: string): { label: string; tone: string } {
  switch (speaker) {
    case "caller":
      return { label: "Caller", tone: "text-red-300" };
    case "victim":
      return { label: "Amma", tone: "text-emerald-200" };
    case "decoy":
      return { label: "Decoy", tone: "text-amber-200" };
    case "guardian":
      return { label: "Rakshak", tone: "text-sky-200" };
    default:
      return { label: "Call audio", tone: "text-mist" };
  }
}
