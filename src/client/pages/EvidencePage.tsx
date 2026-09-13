import { useEffect, useMemo, useState } from "react";
import type { EvidenceBundle } from "../../shared/types";
import { Icon, Shell } from "../components/ui";
import { formatIST } from "../lib/store";

export default function EvidencePage({ sessionId }: { sessionId: string }) {
  const [evidence, setEvidence] = useState<EvidenceBundle | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt = 0) => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/evidence`);
        if (!response.ok) throw new Error(`evidence ${response.status}`);
        const bundle = (await response.json()) as EvidenceBundle;
        if (!cancelled && bundle) {
          setEvidence(bundle);
          return;
        }
        throw new Error("empty bundle");
      } catch {
        if (!cancelled && attempt < 8) {
          window.setTimeout(() => void load(attempt + 1), 1500);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const goldenHour = useMemo(() => {
    if (!evidence) return "—";
    const total = Math.max(0, Math.floor((Date.now() - evidence.generatedAt) / 1000) + elapsed - elapsed);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }, [evidence, elapsed]);

  const download = () => {
    if (!evidence) return;
    const lines = [
      `RAKSHAK — GOLDEN-HOUR RECOVERY PACK`,
      `Session: ${evidence.sessionId}`,
      `Generated: ${new Date(evidence.generatedAt).toLocaleString("en-IN")}`,
      `Peak risk: ${evidence.peakSeverity}/100`,
      ``,
      `== COMPLAINT DRAFT ==`,
      evidence.complaintDraft,
      ``,
      `== IDENTIFIERS ==`,
      ...evidence.identifiers.map((i) => `${i.type}: ${i.value}`),
      ``,
      `== RED FLAGS ==`,
      ...evidence.redFlags.map((f) => `- ${f.stage}: ${f.rationale}`),
      ``,
      `== TIMELINE ==`,
      ...evidence.timeline.map((t) => `[${formatIST(t.ts)}] ${t.kind}: ${t.text}`)
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rakshak-recovery-${sessionId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyDraft = async () => {
    if (!evidence) return;
    await navigator.clipboard.writeText(evidence.complaintDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!evidence) {
    return (
      <Shell>
        <div className="card p-10 text-center text-mist">Building the recovery pack…</div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Golden-hour recovery pack</h1>
          <p className="mt-1 text-sm text-mist">
            Session {evidence.sessionId} · peak risk {Math.round(evidence.peakSeverity)}/100
          </p>
        </div>
        <div className="card px-5 py-3 text-right">
          <div className="text-[11px] uppercase tracking-widest text-mist/60">Time since detection</div>
          <div className="mono text-2xl font-semibold text-amber-200">{goldenHour}</div>
          <div className="text-[11px] text-mist/50">recovery odds drop every hour</div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col gap-5">
          <section className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="tel:1930"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-ink transition hover:bg-emerald-300"
              >
                <Icon name="phone" /> Call 1930 now
              </a>
              <a
                href="https://cybercrime.gov.in"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-line bg-panel px-5 py-3 text-sm text-emerald-100 transition hover:bg-panel-2"
              >
                Open cybercrime.gov.in ↗
              </a>
              <button
                onClick={download}
                className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-emerald-100 transition hover:bg-panel-2"
              >
                Download evidence bundle
              </button>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              {evidence.checklist.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-panel/60 p-3"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(done[item.id])}
                    onChange={(event) => setDone((prev) => ({ ...prev, [item.id]: event.target.checked }))}
                    className="mt-1 h-4 w-4 accent-emerald-400"
                  />
                  <span>
                    <span className={`block text-sm font-medium ${done[item.id] ? "text-mist/50 line-through" : "text-emerald-100"}`}>
                      {item.label}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-mist/70">{item.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-mist/70">Complaint draft</h2>
              <button onClick={() => void copyDraft()} className="chip hover:bg-panel-2">
                {copied ? "copied ✓" : "copy"}
              </button>
            </div>
            <pre className="mono max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-ink-soft p-4 text-[11px] leading-relaxed text-emerald-50/90">
              {evidence.complaintDraft}
            </pre>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">
              Caller identifiers (evidence)
            </h2>
            {evidence.identifiers.length === 0 && <div className="text-sm text-mist/60">None captured.</div>}
            <div className="flex flex-col gap-2">
              {evidence.identifiers.map((identifier) => (
                <div key={identifier.id} className="rounded-lg border border-line bg-panel/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-mist/50">{identifier.type}</div>
                  <div className="mono text-sm text-emerald-100">{identifier.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">Fraud indicators</h2>
            <div className="flex flex-col gap-3">
              {evidence.redFlags.map((flag, index) => (
                <div key={`${flag.stage}-${index}`} className="rounded-xl border border-line bg-panel/60 p-3">
                  <div className="text-sm font-semibold text-emerald-200">{flag.stage}</div>
                  <div className="mt-1 text-xs leading-relaxed text-mist">{flag.rationale}</div>
                  {flag.quotes.length > 0 && (
                    <ul className="mt-2 list-inside list-disc text-xs italic text-mist/70">
                      {flag.quotes.map((quote, quoteIndex) => (
                        <li key={quoteIndex}>"{quote}"</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">Timeline</h2>
            <div className="max-h-[300px] overflow-y-auto text-[11px] leading-relaxed">
              {evidence.timeline.slice(-60).map((entry, index) => (
                <div key={`${entry.ts}-${index}`} className="flex gap-2 border-b border-line/40 py-1">
                  <span className="text-mist/40">{formatIST(entry.ts)}</span>
                  <span className="text-emerald-300">{entry.kind}</span>
                  <span className="text-mist/80">{entry.text}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}
