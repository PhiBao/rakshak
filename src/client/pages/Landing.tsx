import { Shell, Stat } from "../components/ui";
import { navigate, newSessionId } from "../lib/router";

export default function Landing() {
  const startDemo = () => {
    const id = newSessionId();
    navigate(`/call/${id}?demo=1`);
  };

  return (
    <Shell active="demo">
      <section className="grid gap-8 pt-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="chip">🇮🇳 Built for India's digital-arrest crisis</span>
            <span className="chip">Featherless open-weight models</span>
            <span className="chip">Cloudflare realtime</span>
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Blocklists stop numbers.
            <br />
            <span className="text-emerald-300">Rakshak understands the script.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-mist">
            Scammers impersonate the CBI, police and banks, keep victims on a video call, and drain lifetimes of
            savings in minutes. Rakshak listens alongside your parent, recognises the fraud script as it unfolds,
            warns them out loud, alerts the family in real time — and then fights back by baiting the caller and
            turning the call into evidence.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              onClick={startDemo}
              className="rounded-xl bg-emerald-400 px-6 py-3 text-base font-semibold text-ink shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
            >
              ▶ Run the digital-arrest demo
            </button>
            <button
              onClick={() => navigate("/genome")}
              className="rounded-xl border border-line bg-panel px-5 py-3 text-sm font-medium text-emerald-100 transition hover:bg-panel-2"
            >
              Explore the Scam Genome
            </button>
          </div>
          <p className="mt-3 text-xs text-mist/60">
            The demo streams a real recorded digital-arrest call through the live pipeline — real STT, real
            classification, real intervention. Nothing is mocked.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat value="₹22,495 cr" label="Lost to cyber fraud in India in 2025 (NHRC / I4C reporting)" />
          <Stat value="297,727" label="Digital-arrest complaints filed between 2022 and May 2026" />
          <Stat value="2–13%" label="Typical recovery rate after money leaves — speed is everything" />
          <Stat value="3 seconds" label="Of public audio now enough to clone a family member's voice" />
        </div>
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-3">
        {[
          {
            title: "1 · Listen",
            body: "Streaming speech recognition reads the call as it happens and a fraud-script classifier tracks which stage of the playbook the caller is in: authority pretext → accusation → isolation → verification demand."
          },
          {
            title: "2 · Intervene",
            body: "At the first isolation or payment cue, Rakshak speaks a calm warning in Hindi or English, fills the screen with a stop card, and pushes a live alert to the family war room."
          },
          {
            title: "3 · Fight back",
            body: "The counter-agent takes over the line — stalling the scammer, making them repeat account numbers and UPI IDs — while the golden-hour pack turns the call into a filing-ready complaint."
          }
        ].map((step) => (
          <div key={step.title} className="card p-5">
            <h3 className="text-lg font-semibold text-emerald-200">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mist">{step.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-10 card p-6">
        <h2 className="text-lg font-semibold">The Scam Genome</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist">
          Every detected call is distilled into a structured fingerprint: script family, stage reached, tactics,
          and the scammer's own payment identifiers (UPI IDs, account numbers, numbers). The registry compounds with
          every call — a shared defence that number blocklists cannot replicate.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <button
            onClick={() => navigate("/genome")}
            className="rounded-xl border border-line bg-panel px-4 py-2 text-emerald-100 hover:bg-panel-2"
          >
            View live registry →
          </button>
          <span className="chip self-center">5 scam families · stage-level intelligence · identifier index</span>
        </div>
      </section>
    </Shell>
  );
}
