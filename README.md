# Rakshak 🛡️

**Blocklists stop numbers. Rakshak understands the script — and fights back.**

Rakshak is a real-time AI defence layer for phone fraud against Indian families. It listens
alongside the person being targeted, recognises the *digital-arrest* playbook as it unfolds,
warns them out loud in Hindi or English, alerts the family while the call is still happening,
baits the scammer with a counter-agent to expose their payment rails, and compresses the
"golden hour" after a fraud attempt into a filing-ready complaint pack.

- **Live demo:** https://rakshak.kiter0211.workers.dev
- **Demo call:** the parent view streams a synthetic digital-arrest recording through the real pipeline (no mocks).
- Built for the **BunnieX Hackathon 2026** (TechieBunnies).

![Guardian warning](docs/screenshots/01-guardian-warning.png)

<p align="center">
  <img src="docs/screenshots/02-family-war-room.png" width="49%" alt="Family war room" />
  <img src="docs/screenshots/03-golden-hour.png" width="49%" alt="Golden-hour recovery pack" />
</p>

---

## Why this exists

| Fact | Source |
| --- | --- |
| Indians lost **₹22,495 crore** to cyber fraud in 2025; ₹52,976 crore over six years | NHRC / I4C reporting (2026) |
| **297,727** digital-arrest complaints between 2022 and May 2026, ₹4,057 crore lost | Government data reported by News18 (Jul 2026) |
| Recovery after money leaves is **2–13%** — speed is the only real defence | Karnataka Home Dept / cybercrime reporting |
| **3–5 seconds** of public audio is enough to clone a family member's voice | 2026 reporting on AI voice-cloning fraud |
| Truecaller's 2026 family protection stops at caller ID + remote hangup; it does not understand the conversation | TechCrunch (Mar 2026) |

Every existing tool stops at *who is calling*. The fraud happens *inside the call*.

## What it does

1. **Listen** — Streaming speech recognition (Workers AI Deepgram Flux/Nova-3) transcribes the
   mixed call audio. A fraud-script classifier (Featherless open-weight LLM) tracks which stage of
   the known playbook the caller is in: authority pretext → accusation → isolation → video
   surveillance → fund verification → extraction.
2. **Intervene** — When risk crosses the isolation/payment threshold, Rakshak speaks a calm
   warning (Featherless Kokoro TTS, Hindi or English), fills the screen with a stop card, and
   pushes a live alert to the family war room.
3. **Fight back** — The counter-agent ("Sunita Devi", a deliberately slow and hard-of-hearing
   persona) takes over the call, stalls the scammer, and makes them repeat account numbers and
   UPI IDs. Spoken identifiers are normalised and captured as evidence.
4. **Recover** — The golden-hour pack contains the timeline, red flags, caller identifiers, a
   pre-filled complaint draft for cybercrime.gov.in / 1930, and a checklist for bank and UPI
   disputes — the only mechanism that has ever recovered fraud losses.
5. **Learn** — Every confirmed call contributes a structured fingerprint to the **Scam Genome**,
   a shared registry of scripts and scammer identifiers. Number blocklists cannot compound; this can.

## Architecture

```
Parent device (web/mic)                    Cloudflare edge
┌──────────────────┐   WS: audio + events  ┌────────────────────────────────────────┐
│  Parent Shield   │ ────────────────────► │  Durable Object "CallAgent"            │
│  (VoiceClient +  │                       │   ├─ STT: Workers AI Flux / Nova-3     │
│   file/mic audio)│ ◄──────────────────── │   ├─ Risk: Featherless DeepSeek-V4     │
└──────────────────┘   transcripts, risk,   │   │   + deterministic rules fallback   │
                       TTS warnings         │   ├─ Script state machine + policy      │
┌──────────────────┐ ◄──────────────────── │   ├─ TTS: Featherless Kokoro / Aura     │
│ Family War Room  │   live transcript,    │   ├─ Identifier extraction + genome     │
│ (guardian)       │   alerts, actions     │   └─ SQLite session log                 │
└──────────────────┘                       └──────────────┬─────────────────────────┘
                                                          │ record()
┌──────────────────┐                       ┌──────────────▼─────────────────────────┐
│ Golden-hour pack │ ◄──────────────────── │  Durable Object "GenomeAgent"          │
│ Scam Genome      │   evidence + registry │   scripts · identifiers · contributions │
└──────────────────┘                       └────────────────────────────────────────┘
```

- **Frontend:** Vite + React 19 + Tailwind v4, served as Workers static assets.
- **Realtime:** Cloudflare Agents SDK (Durable Objects + WebSockets + `@cloudflare/voice` mixin).
- **Speech-to-text:** Workers AI `@cf/deepgram/flux` (conversational streaming) with keyterms.
- **Reasoning:** Featherless `deepseek-ai/DeepSeek-V4-Flash` (OpenAI-compatible, schema-validated
  JSON) with a deterministic rule engine fallback.
- **Voice:** Featherless `hexgrad/Kokoro-82M` (Hindi + English voices) with Workers AI Aura fallback.
- **State:** Durable Object SQLite for per-session logs; GenomeAgent SQLite for the registry.

## Run it locally

```bash
pnpm install
cp .env.example .dev.vars   # add FEATHERLESS_API_KEY
pnpm dev                    # http://localhost:5173
```

Useful scripts:

```bash
pnpm test                   # unit tests (parsing, extraction, rules, stage mapping)
pnpm build                  # typecheck + production build
pnpm deploy                 # build + wrangler deploy
node scripts/generate-demo-call.mjs   # regenerate the synthetic scam call (Featherless TTS)
node scripts/e2e-demo.mjs             # headless end-to-end pipeline test
node scripts/e2e-warroom.mjs          # two-tab war room + evidence test
node scripts/screenshots.mjs          # capture UI screenshots for QA
```

## Demo script (2 minutes)

1. Open the live demo → **Run the digital-arrest demo**.
2. Parent Shield streams the call. Watch the transcript and the stage tracker climb:
   *Authority pretext → Accusation → Isolation*.
3. At *"you must not tell anyone"* the guardian voice interrupts in Hindi; the stop card fills the
   screen and the war room (`Open family war room`) lights up with a live alert.
4. In the war room, hit **Engage counter-agent**. The decoy appears in the transcript, stalls the
   caller and asks them to repeat the payment details.
5. Identifiers appear under **Captured identifiers**:
   `account 504122339910` and `upi verificil@okaxis` (auto-normalised from spoken words).
6. End the call → the **golden-hour recovery pack** shows the complaint draft, the 1930 runbook
   and the evidence bundle. Open the **Scam Genome** to see the new contribution and look up the
   captured UPI ID.

## Demo data provenance & honesty notes

- The demo call is a **synthetic recording** generated with Featherless TTS from a script derived
  from publicly documented digital-arrest modus operandi (`data/demo-calls/digital-arrest.script.json`).
  No real person or victim is depicted.
- The app runs the **real pipeline** on that audio: real streaming STT, real model inference, real
  TTS, real Durable Object state. The only simulated element is the phone line itself (browser
  audio instead of a carrier call), clearly labelled in the UI.
- If Featherless is unreachable, the classifier falls back to a deterministic rule engine and TTS
  falls back to Workers AI Aura. Every fallback is visible in the audit trail.
- Spoken account numbers are normalised (words → digits) and slightly mis-heard UPI suffixes are
  repaired against a known-suffix list; captured identifiers are evidence, not legal proof.

## Privacy & security

- Consent-first UX; one-tap stop. Audio is processed transiently for transcription and is not
  stored by default.
- Guardian access is scoped by session; all interventions and alerts are written to an audit log.
- Secrets are Worker bindings only (`wrangler secret put FEATHERLESS_API_KEY`); nothing sensitive
  is shipped to the client.
- The decoy persona is fictional and never impersonates the victim or a real family member.
- The product performs no payments and never auto-files anything on the user's behalf.

## Roadmap

- Telephony bridge (Exotel/Twilio) so the protection line can sit in front of a real SIM via call forwarding.
- WhatsApp/SMS alert delivery for guardians.
- Voice-authenticity check (speaker verification against enrolled family voiceprints).
- Public Scam Genome API for banks, insurers and NGOs; identifier reputation lookups.
- Regional languages beyond Hindi/English (Marathi, Tamil, Telugu, Bengali).

## License

MIT — see [LICENSE](LICENSE).
