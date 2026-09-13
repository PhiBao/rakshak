export type Speaker = "caller" | "victim" | "decoy" | "guardian" | "unknown";

export type ScamFamilyKey =
  | "digital_arrest"
  | "voice_clone_emergency"
  | "kyc_bank_fraud"
  | "tech_support"
  | "lottery_prize"
  | "unknown";

export interface ScamStage {
  id: string;
  name: string;
  description: string;
  indicators: string[];
}

export interface ScamScript {
  key: ScamFamilyKey;
  name: string;
  summary: string;
  stages: ScamStage[];
  paymentMethods: string[];
  sourceNote: string;
}

export interface Utterance {
  id: string;
  sessionId: string;
  speaker: Speaker;
  text: string;
  ts: number;
  confidence: number;
  final: boolean;
}

export interface RiskEvent {
  id: string;
  sessionId: string;
  ts: number;
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

export interface Intervention {
  id: string;
  sessionId: string;
  ts: number;
  kind: "warn" | "remote_end" | "decoy_start" | "decoy_stop" | "notify" | "guardian_speak";
  triggeredBy: "system" | "guardian" | "victim";
  text: string;
}

export interface SessionAlert {
  id: string;
  sessionId: string;
  ts: number;
  kind: "scam_detected" | "high_risk" | "intervention" | "recovery";
  channel: "war_room" | "email" | "whatsapp";
  message: string;
  acknowledged: boolean;
}

export interface Identifier {
  id: string;
  sessionId: string;
  ts: number;
  type: "phone" | "upi" | "account" | "url" | "handle";
  value: string;
  display: string;
}

export interface PipelineLog {
  id: string;
  sessionId: string;
  ts: number;
  kind: "stt" | "classify" | "tts" | "extract" | "genome" | "policy" | "error";
  status: "ok" | "fallback" | "error";
  model?: string;
  latencyMs?: number;
  detail?: string;
}

export interface SessionSnapshot {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "live" | "ended";
  mode: "demo" | "live";
  language: "en" | "hi";
  family?: ScamFamilyKey;
  peakSeverity: number;
  decoyActive: boolean;
  utterances: Utterance[];
  riskEvents: RiskEvent[];
  interventions: Intervention[];
  alerts: SessionAlert[];
  identifiers: Identifier[];
  pipeline: PipelineLog[];
}

export type RakshakEvent =
  | { type: "session.snapshot"; session: SessionSnapshot }
  | { type: "transcript.final"; utterance: Utterance }
  | { type: "risk.update"; risk: RiskEvent; peakSeverity: number }
  | { type: "intervention.warning"; intervention: Intervention; severity: number }
  | { type: "alert.sent"; alert: SessionAlert }
  | { type: "decoy.update"; active: boolean; line?: string }
  | { type: "audio.speak"; role: "guardian" | "decoy"; text: string; audio: string; format: string }
  | { type: "identifier.found"; identifier: Identifier }
  | { type: "recovery.ready"; evidenceUrl: string; complaintDraft: string }
  | { type: "pipeline.log"; log: PipelineLog }
  | { type: "genome.updated"; scriptKey: string; callCount: number }
  | { type: "session.ended"; endedAt: number };

export interface EvidenceBundle {
  sessionId: string;
  generatedAt: number;
  peakSeverity: number;
  family?: ScamFamilyKey;
  timeline: Array<{ ts: number; kind: string; text: string; severity?: number }>;
  identifiers: Identifier[];
  redFlags: Array<{ stage: string; rationale: string; quotes: string[] }>;
  complaintDraft: string;
  checklist: Array<{ id: string; label: string; detail: string; done: boolean }>;
}
