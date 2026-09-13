import { scriptByKey } from "../shared/genome";
import type {
  EvidenceBundle,
  Identifier,
  Intervention,
  RiskEvent,
  SessionAlert,
  Utterance
} from "../shared/types";

interface EvidenceInput {
  sessionId: string;
  peakSeverity: number;
  family?: string;
  utterances: Utterance[];
  riskEvents: RiskEvent[];
  interventions: Intervention[];
  alerts: SessionAlert[];
  identifiers: Identifier[];
}

export function buildEvidence(input: EvidenceInput): EvidenceBundle {
  const now = Date.now();
  const script = scriptByKey(input.family);
  const timeline: EvidenceBundle["timeline"] = [
    ...input.utterances.map((u) => ({
      ts: u.ts,
      kind: u.speaker === "decoy" ? "decoy" : u.speaker === "guardian" ? "intervention" : "speech",
      text: u.text,
      severity: undefined
    })),
    ...input.riskEvents.map((r) => ({
      ts: r.ts,
      kind: "risk",
      text: `${r.stageName} · ${r.severity}/100 · ${r.rationale}`,
      severity: r.severity
    })),
    ...input.interventions.map((i) => ({ ts: i.ts, kind: "intervention", text: i.text })),
    ...input.alerts.map((a) => ({ ts: a.ts, kind: "alert", text: a.message }))
  ].sort((a, b) => a.ts - b.ts);

  const redFlags = (() => {
    const byStage = new Map<string, { stage: string; rationale: string; quotes: string[]; severity: number }>();
    for (const risk of input.riskEvents) {
      if (risk.family === "unknown" || risk.severity < 40) continue;
      const existing = byStage.get(risk.stageId);
      if (!existing || risk.severity >= existing.severity) {
        byStage.set(risk.stageId, {
          stage: risk.stageName,
          rationale: risk.rationale,
          quotes: risk.quotes,
          severity: risk.severity
        });
      }
    }
    return [...byStage.values()].map(({ stage, rationale, quotes }) => ({ stage, rationale, quotes })).slice(-6);
  })();

  const identifiers = dedupeIdentifiers(input.identifiers);
  const complaintDraft = buildComplaintDraft(input, script?.name ?? "phone fraud", identifiers);

  return {
    sessionId: input.sessionId,
    generatedAt: now,
    peakSeverity: input.peakSeverity,
    family: script?.key,
    timeline,
    identifiers,
    redFlags,
    complaintDraft,
    checklist: [
      {
        id: "helpline",
        label: "Call 1930 (National Cyber Crime Helpline)",
        detail:
          "Report within the first hour. Give the fraudster's numbers, UPI IDs and account numbers listed here so the receiving account can be frozen.",
        done: false
      },
      {
        id: "portal",
        label: "File complaint on cybercrime.gov.in",
        detail: "Paste the complaint draft below. Attach screenshots of the call, this report, and any payment proof.",
        done: false
      },
      {
        id: "bank",
        label: "Ask your bank to freeze / flag the beneficiary account",
        detail:
          "Use the account numbers and UPI IDs below. Mention 'cyber fraud, golden hour' and request a lien on the beneficiary account.",
        done: false
      },
      {
        id: "upi",
        label: "Report the UPI ID in your UPI app",
        detail: "Open the transaction, choose 'Report fraud', and mark the beneficiary as fraudulent.",
        done: false
      },
      {
        id: "preserve",
        label: "Preserve the evidence bundle",
        detail: "Download this report and keep the original call recording / screenshots.",
        done: false
      }
    ]
  };
}

function dedupeIdentifiers(identifiers: Identifier[]): Identifier[] {
  const seen = new Set<string>();
  const result: Identifier[] = [];
  for (const identifier of identifiers) {
    const key = `${identifier.type}:${identifier.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(identifier);
  }
  return result;
}

function buildComplaintDraft(input: EvidenceInput, familyName: string, identifiers: Identifier[]): string {
  const callTime = input.utterances[0]?.ts ?? Date.now();
  const identifierLines = identifiers.length
    ? identifiers.map((i) => `  - ${i.type.toUpperCase()}: ${i.value}`).join("\n")
    : "  - None captured";
  const redFlagLines = input.riskEvents
    .filter((r) => r.severity >= 40)
    .slice(-5)
    .map((r) => `  - ${r.stageName}: ${r.rationale}`)
    .join("\n");

  return [
    `To: National Cyber Crime Reporting Portal (cybercrime.gov.in) / Helpline 1930`,
    `Subject: Attempted ${familyName} — fraudulent call on ${new Date(callTime).toLocaleString("en-IN")}`,
    ``,
    `Respected Sir/Madam,`,
    ``,
    `I wish to report an attempted phone fraud against my family member, detected and documented in real time by Rakshak (session ${input.sessionId}).`,
    ``,
    `Nature of fraud: ${familyName}`,
    `Peak risk score: ${input.peakSeverity}/100`,
    ``,
    `Caller identifiers captured:`,
    identifierLines,
    ``,
    `Fraud script indicators observed:`,
    redFlagLines || "  - See attached transcript and risk timeline",
    ``,
    `Evidence attached:`,
    `  - Full call transcript with timestamps`,
    `  - Risk timeline generated by the fraud-script detector`,
    `  - Interception and family-alert log`,
    ``,
    `Requested action: register a complaint, trace the beneficiary accounts / UPI IDs above, and freeze them under the golden-hour procedure.`,
    ``,
    `The caller instructed secrecy, impersonated government authority, and demanded payments — the documented modus operandi of digital-arrest fraud.`,
    ``,
    `Regards,`,
    `[Name]`,
    `[Phone] · [City]`
  ].join("\n");
}
