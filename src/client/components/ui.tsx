import { useEffect, useRef } from "react";
import { GENOME_SEED, scriptByKey } from "../../shared/genome";
import type { PipelineLog, SessionSnapshot, Utterance } from "../../shared/types";
import { formatIST, riskColor, speakerLabel } from "../lib/store";
import { navigate } from "../lib/router";

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path fill="#34d399" d="M16 2 4 7v9c0 7.2 5.1 12.3 12 14 6.9-1.7 12-6.8 12-14V7L16 2Z" />
      <path fill="#04110d" d="m14.3 20.3-4-4 1.9-1.9 2.1 2.1 5.6-5.6 1.9 1.9-7.5 7.5Z" />
    </svg>
  );
}

export type IconName = "play" | "mic" | "stop" | "phone" | "bot" | "alert" | "check" | "arrow-right" | "external";

const ICONS: Record<IconName, React.ReactNode> = {
  play: <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />,
  mic: (
    <>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
  phone: (
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  ),
  bot: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V4M9 13h.01M15 13h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 3 19h18L12 4Z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  check: <path d="m5 13 4 4L19 7" />,
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  )
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

export function Shell({ children, active }: { children: React.ReactNode; active?: string }) {
  const links: Array<{ href: string; label: string; key: string }> = [
    { href: "/", label: "Demo", key: "demo" },
    { href: "/genome", label: "Scam Genome", key: "genome" }
  ];
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-ink/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <button className="flex items-center gap-2" onClick={() => navigate("/")}>
            <Logo size={26} />
            <span className="text-lg font-semibold tracking-tight">Rakshak</span>
            <span className="chip hidden sm:inline-flex">beta</span>
          </button>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            {links.map((link) => (
              <button
                key={link.key}
                onClick={() => navigate(link.href)}
                className={`rounded-lg px-3 py-1.5 transition ${
                  active === link.key ? "bg-panel-2 text-emerald-200" : "text-mist hover:bg-panel-2/70"
                }`}
              >
                {link.label}
              </button>
            ))}
            <a
              href="https://github.com/PhiBao/rakshak"
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg px-3 py-1.5 text-mist hover:bg-panel-2/70 sm:block"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-xs text-mist/60">
        Rakshak · real-time digital-arrest defence for Indian families · Featherless · Deepgram · Cloudflare
      </footer>
    </div>
  );
}

export function SeverityMeter({ severity, peak = false }: { severity: number; peak?: boolean }) {
  const color = riskColor(severity);
  return (
    <div className="w-full">
      <div className="mb-1 flex items-end justify-between">
        <span className="text-xs uppercase tracking-widest text-mist/70">{peak ? "Peak risk" : "Risk"}</span>
        <span className="mono text-2xl font-semibold" style={{ color }}>
          {Math.round(severity)}
          <span className="text-sm text-mist/60">/100</span>
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-panel-2">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.max(3, severity)}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-semibold text-emerald-200">{value}</div>
      <div className="mt-1 text-xs leading-snug text-mist/80">{label}</div>
    </div>
  );
}

export function StageTracker({ family, stageId }: { family?: string; stageId?: string }) {
  const script = scriptByKey(family);
  if (!script) {
    return <div className="text-sm text-mist/60">No scam script detected yet.</div>;
  }
  const activeIndex = Math.max(
    0,
    script.stages.findIndex((stage) => stage.id === stageId)
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {script.stages.map((stage, index) => {
        const active = index === activeIndex;
        const passed = index < activeIndex;
        return (
          <span
            key={stage.id}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              active
                ? "border-red-400/60 bg-red-500/15 text-red-200"
                : passed
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                  : "border-line bg-panel/60 text-mist/60"
            }`}
            title={stage.description}
          >
            {stage.name}
          </span>
        );
      })}
    </div>
  );
}

export function TranscriptList({
  utterances,
  interim,
  decoyActive
}: {
  utterances: Utterance[];
  interim?: string | null;
  decoyActive?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [utterances.length, interim]);
  return (
    <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
      {utterances.length === 0 && !interim && (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-mist/60">
          Call audio will appear here in real time…
        </div>
      )}
      {utterances.map((utterance) => {
        const speaker = speakerLabel(utterance.speaker);
        return (
          <div
            key={utterance.id}
            className={`rounded-xl border p-2.5 ${
              utterance.speaker === "decoy"
                ? "border-amber-400/30 bg-amber-400/5"
                : utterance.speaker === "caller"
                  ? "border-red-400/20 bg-red-500/5"
                  : "border-line bg-panel/50"
            }`}
          >
            <div className="mb-1 flex items-center gap-2 text-[11px]">
              <span className={`font-semibold ${speaker.tone}`}>{speaker.label}</span>
              <span className="mono text-mist/40">{formatIST(utterance.ts)}</span>
            </div>
            <div className="text-sm leading-relaxed text-emerald-50/90">{utterance.text}</div>
          </div>
        );
      })}
      {interim && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-2.5">
          <div className="mb-1 text-[11px] font-semibold text-emerald-200">Listening…</div>
          <div className="text-sm italic text-emerald-100/70">{interim}</div>
        </div>
      )}
      {decoyActive && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-2.5 text-xs text-amber-100/80">
          Counter-agent active — Rakshak is stalling the caller and asking them to repeat payment details.
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

export function PipelinePanel({ logs }: { logs: PipelineLog[] }) {
  const recent = logs.slice(-40).reverse();
  return (
    <div className="mono max-h-[320px] overflow-y-auto pr-1 text-[11px] leading-relaxed">
      {recent.length === 0 && <div className="text-mist/50">Pipeline events will stream here…</div>}
      {recent.map((log) => (
        <div key={log.id} className="flex items-start gap-2 border-b border-line/40 py-1">
          <span className="text-mist/40">{formatIST(log.ts)}</span>
          <span
            className={
              log.status === "error" ? "text-red-300" : log.status === "fallback" ? "text-amber-300" : "text-emerald-300"
            }
          >
            {log.kind}
          </span>
          <span className="text-mist/70">{log.model ?? ""}</span>
          {typeof log.latencyMs === "number" && <span className="text-mist/50">{log.latencyMs}ms</span>}
          <span className="ml-auto text-right text-mist/60">{log.detail}</span>
        </div>
      ))}
    </div>
  );
}

export function FamilyBadge({ family, severity }: { family?: string; severity: number }) {
  const script = scriptByKey(family);
  return (
    <div className="flex items-center gap-2">
      <span
        className="rounded-full px-3 py-1 text-xs font-semibold"
        style={{ background: `${riskColor(severity)}22`, color: riskColor(severity), border: `1px solid ${riskColor(severity)}55` }}
      >
        {script?.name ?? "Monitoring"}
      </span>
      {script && <span className="chip">{script.stages.length} stages</span>}
    </div>
  );
}

export function GenomeFamilies() {
  return GENOME_SEED.length;
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-4 text-sm text-mist/60">{children}</div>;
}

export function SnapshotMeta({ session }: { session: SessionSnapshot }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-mist/70">
      <span className="chip">session {session.sessionId}</span>
      <span className="chip">{session.mode}</span>
      <span className="chip">{session.language === "hi" ? "Hindi + English" : "English"}</span>
      <span className="chip">{session.status}</span>
    </div>
  );
}
