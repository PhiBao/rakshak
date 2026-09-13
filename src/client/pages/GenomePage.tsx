import { useEffect, useState } from "react";
import { useAgent } from "agents/react";
import type { GenomeContribution, GenomeEntry } from "../../worker/genome-agent";
import { EmptyHint, Shell } from "../components/ui";

interface Totals {
  calls: number;
  identifiers: number;
  contributions: number;
}

export default function GenomePage() {
  const [entries, setEntries] = useState<GenomeEntry[]>([]);
  const [totals, setTotals] = useState<Totals>({ calls: 0, identifiers: 0, contributions: 0 });
  const [recent, setRecent] = useState<GenomeContribution[]>([]);
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<{ found: boolean; reportCount: number; display?: string } | null>(null);
  const agent = useAgent({ agent: "GenomeAgent", name: "global" });

  useEffect(() => {
    agent.ready
      .then(async () => {
        const [list, stats, contributions] = await Promise.all([
          agent.call<GenomeEntry[]>("list"),
          agent.call<Totals>("totals"),
          agent.call<GenomeContribution[]>("recent", [8])
        ]);
        setEntries(list);
        setTotals(stats);
        setRecent(contributions);
      })
      .catch(() => undefined);
  }, [agent]);

  const runLookup = async () => {
    if (!query.trim()) return;
    const result = await agent.call<{ found: boolean; reportCount: number; display?: string }>("lookupIdentifier", [query.trim()]);
    setLookup(result);
  };

  return (
    <Shell active="genome">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scam Genome</h1>
          <p className="mt-1 max-w-2xl text-sm text-mist">
            A structured, growing registry of fraud scripts and the payment identifiers scammers leave behind. Every
            detected call contributes — number blocklists cannot compound like this.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="card px-4 py-2 text-center">
            <div className="text-xl font-semibold text-emerald-200">{totals.calls}</div>
            <div className="text-[11px] text-mist/60">live contributions</div>
          </div>
          <div className="card px-4 py-2 text-center">
            <div className="text-xl font-semibold text-emerald-200">{totals.identifiers}</div>
            <div className="text-[11px] text-mist/60">identifiers indexed</div>
          </div>
        </div>
      </div>

      <section className="card mb-6 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist/70">Identifier lookup</h2>
        <p className="mt-1 text-xs text-mist/60">
          Paste a UPI ID, phone number or account number a caller gave you — check whether it is already in the
          registry.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. 9876543210 or officer.verify@okaxis"
            className="mono min-w-[260px] flex-1 rounded-xl border border-line bg-ink-soft px-4 py-2.5 text-sm text-emerald-50 outline-none focus:border-emerald-400/60"
          />
          <button
            onClick={() => void runLookup()}
            className="rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-emerald-300"
          >
            Check registry
          </button>
        </div>
        {lookup && (
          <div className={`mt-3 rounded-xl border p-3 text-sm ${lookup.found ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-line bg-panel/60 text-mist"}`}>
            {lookup.found
              ? `Found in registry — reported ${lookup.reportCount} time(s)${lookup.display ? ` · ${lookup.display}` : ""}`
              : "Not found yet. If this call is a scam, run the demo protection and it will be indexed."}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => (
          <div key={entry.key} className="card flex flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-emerald-100">{entry.name}</h3>
              {entry.live ? (
                <span className="chip border-emerald-400/50 text-emerald-200">live +{entry.callCount}</span>
              ) : (
                <span className="chip">seeded</span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-mist">{entry.summary}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {entry.stageNames.map((stage) => (
                <span key={stage} className="rounded-full border border-line bg-panel/60 px-2 py-0.5 text-[10px] text-mist/70">
                  {stage}
                </span>
              ))}
            </div>
            <div className="mt-auto pt-4 text-[11px] text-mist/50">
              {entry.callCount} live contribution{entry.callCount === 1 ? "" : "s"} · {entry.paymentMethods.join(" · ")}
            </div>
          </div>
        ))}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-mist/70">Recent contributions</h2>
        {recent.length === 0 ? (
          <EmptyHint>
            No live contributions yet. Run the demo on the Demo page — when the scam is confirmed, this registry grows.
          </EmptyHint>
        ) : (
          <div className="mono flex flex-col gap-1 text-[11px] text-mist/80">
            {recent.map((contribution) => (
              <div key={contribution.id} className="flex gap-3 border-b border-line/40 py-1">
                <span className="text-mist/40">{new Date(contribution.ts).toLocaleTimeString("en-IN")}</span>
                <span className="text-emerald-300">{contribution.scriptKey}</span>
                <span>{contribution.stageId ?? "stage unknown"}</span>
                <span className="ml-auto text-mist/50">{contribution.identifierTypes.join(", ") || "no identifiers"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="mt-4 text-[11px] leading-relaxed text-mist/40">
        Seed scripts are derived from public reporting (MHA/I4C, Supreme Court proceedings, CBI Operation Chakra,
        NHRC, Reserve Bank and bank advisories). Live counts come from sessions on this deployment.
      </p>
    </Shell>
  );
}
