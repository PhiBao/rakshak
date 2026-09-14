#!/usr/bin/env node
/**
 * Builds the narrated demo video from a recording work directory.
 *
 * Inputs (written by scripts/record-demo.mjs):
 *   - frames/frame-*.jpg + frames.txt  (video frames with durations)
 *   - meta.json                        (clickTime, firstFrameWallMs, timeline)
 *   - snapshot.json                    (utterances, interventions, risk timeline)
 *
 * Output: a single MP4 with:
 *   - narrated intro and outro cards
 *   - the screen recording with the call audio, in-app guardian/decoy voices and
 *     narration mixed with ducking so nothing overlaps
 *
 * Usage: node scripts/build-demo-video.mjs <workDir> <outFile>
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workDir = process.argv[2];
const outFile = process.argv[3] ?? join(root, "docs", "submission", "rakshak-demo.mp4");
if (!workDir || !existsSync(join(workDir, "meta.json"))) {
  console.error("usage: node scripts/build-demo-video.mjs <workDir with meta.json> <outFile>");
  process.exit(1);
}

const meta = JSON.parse(readFileSync(join(workDir, "meta.json"), "utf8"));
const snapshot = JSON.parse(readFileSync(join(workDir, "snapshot.json"), "utf8"));
const videoStartMs = meta.firstFrameWallMs ?? meta.clickTime;
const buildDir = join(workDir, "build");
mkdirSync(buildDir, { recursive: true });

function loadEnv() {
  const values = {};
  try {
    for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) values[match[1]] = match[2];
    }
  } catch {
    // ignore
  }
  return values;
}
const env = loadEnv();
const apiKey = process.env.FEATHERLESS_API_KEY ?? env.OPENAI_COMPAT_API_KEY;
const baseUrl = process.env.FEATHERLESS_BASE_URL ?? env.OPENAI_COMPAT_BASE_URL ?? "https://api.featherless.ai/v1";

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { stdio: "inherit", ...options });
}

function duration(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file
  ]).toString().trim();
  return Number(out) || 0;
}

async function tts(text, voice, outFile) {
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "hexgrad/Kokoro-82M",
      input: text,
      voice,
      response_format: "wav",
      delivery: "bulk",
      encoding: "binary"
    })
  });
  if (!response.ok) throw new Error(`tts failed: ${response.status} for "${text.slice(0, 40)}"`);
  writeFileSync(outFile, Buffer.from(await response.arrayBuffer()));
}

const NARRATION = {
  intro: [
    "Every day in India, scammers call elderly people pretending to be the C.B.I. or the police.",
    "They threaten arrest, order silence, and push life savings out through instant transfers.",
    "Once the money leaves, only a small fraction is ever recovered.",
    "This is Rakshak: an A.I. that sits inside the call, and fights back."
  ].join(" "),
  early: "This is a recorded scam call, streaming through Rakshak's live pipeline. The caller is impersonating a C.B.I. officer.",
  warning: "He orders her to tell no one. Rakshak flags the isolation tactic, interrupts in Hindi, and alerts her family while the call is still happening. Then it fights back: a counter-agent stalls the scammer and captures his payment details.",
  callEnded: "The call is over. Rakshak has already turned it into an evidence pack: the full transcript, the risk timeline, and the caller's own payment identifiers.",
  recovery: "This is the golden-hour pack: a complaint draft for the 1930 helpline and cybercrime.gov.in, the scammer's account and U.P.I. I.D., and a checklist to freeze the money.",
  identifiers: "These are the scammer's own identifiers, captured as evidence — the account number and the U.P.I. I.D., ready for the complaint.",
  genome: "And every detected call feeds the Scam Genome — script fingerprints and scammer identifiers that protect the next family before the call even arrives.",
  closing: "In under a minute: a scam interrupted, a family alerted, and a complaint ready to file.",
  outro: [
    "Rakshak protects one family at a time. The Scam Genome protects everyone.",
    "Blocklists stop numbers. Rakshak understands the script, and turns every call into a trap."
  ].join(" ")
};

const CARD_CSS = `
  body { margin:0; width:1280px; height:720px; background:#04110d; color:#e8f5ef;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans Devanagari", sans-serif;
         display:flex; flex-direction:column; justify-content:center; padding:80px 90px; box-sizing:border-box;
         background-image: radial-gradient(900px 480px at 85% -10%, rgba(52,211,153,.16), transparent 60%),
                           radial-gradient(700px 420px at 0% 110%, rgba(251,191,36,.10), transparent 55%); }
  h1 { font-size:64px; margin:0 0 18px; letter-spacing:-.02em; }
  h2 { font-size:40px; margin:0 0 22px; color:#34d399; letter-spacing:-.01em; }
  p { font-size:22px; line-height:1.55; color:#b7d6c9; margin:0 0 12px; max-width:1050px; }
  .row { display:flex; gap:18px; margin-top:26px; flex-wrap:wrap; }
  .stat { border:1px solid #1d4436; border-radius:16px; padding:18px 22px; background:rgba(13,35,28,.75); }
  .stat b { display:block; font-size:34px; color:#34d399; }
  .stat span { font-size:15px; color:#b7d6c9; }
  .url { margin-top:34px; font-size:20px; color:#fbbf24; }
`;

function writeCards() {
  const title = `<!doctype html><html><head><meta charset="utf-8"><style>${CARD_CSS}</style></head><body>
    <svg width="74" height="74" viewBox="0 0 32 32" style="margin-bottom:26px"><path fill="#34d399" d="M16 2 4 7v9c0 7.2 5.1 12.3 12 14 6.9-1.7 12-6.8 12-14V7L16 2Z"/><path fill="#04110d" d="m14.3 20.3-4-4 1.9-1.9 2.1 2.1 5.6-5.6 1.9 1.9-7.5 7.5Z"/></svg>
    <h1>Rakshak</h1>
    <h2>The AI that sits inside the scam call — and fights back</h2>
    <p>Real-time defence against India's digital-arrest scams: it warns the victim mid-call, alerts the family, baits the scammer, and turns every call into evidence and shared intelligence.</p>
    <div class="row">
      <div class="stat"><b>₹22,495 cr</b><span>lost to cyber fraud in India in 2025</span></div>
      <div class="stat"><b>2–13%</b><span>recovery after the money leaves</span></div>
      <div class="stat"><b>3 sec</b><span>of audio is enough to clone a voice</span></div>
    </div>
    <div class="url">BunnieX Hackathon 2026 · Featherless · Deepgram · Cloudflare</div>
  </body></html>`;

  const outro = `<!doctype html><html><head><meta charset="utf-8"><style>${CARD_CSS}</style></head><body>
    <svg width="66" height="66" viewBox="0 0 32 32" style="margin-bottom:24px"><path fill="#34d399" d="M16 2 4 7v9c0 7.2 5.1 12.3 12 14 6.9-1.7 12-6.8 12-14V7L16 2Z"/><path fill="#04110d" d="m14.3 20.3-4-4 1.9-1.9 2.1 2.1 5.6-5.6 1.9 1.9-7.5 7.5Z"/></svg>
    <h2>Rakshak protects one family.<br/>The Scam Genome protects everyone.</h2>
    <p>Every detected call contributes a structured fingerprint — script, stage, tactics and the scammer's own identifiers — to a registry that compounds with every call.</p>
    <div class="row">
      <div class="stat"><b>Listen</b><span>script-aware, not number-based</span></div>
      <div class="stat"><b>Intervene</b><span>spoken warning + family alert</span></div>
      <div class="stat"><b>Fight back</b><span>counter-agent + evidence</span></div>
    </div>
    <div class="url">rakshak.kiter0211.workers.dev · github.com/PhiBao/rakshak</div>
  </body></html>`;

  writeFileSync(join(buildDir, "title.html"), title);
  writeFileSync(join(buildDir, "outro.html"), outro);
  const chrome = process.env.CHROME_BIN ?? "/home/kiter/.local/bin/google-chrome";
  for (const name of ["title", "outro"]) {
    run(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1280,720",
      `--screenshot=${join(buildDir, `${name}.png`)}`,
      `file://${join(buildDir, `${name}.html`)}`
    ]);
  }
}

async function generateVoices() {
  const narrationDir = join(buildDir, "narration");
  mkdirSync(narrationDir, { recursive: true });
  const files = {};
  for (const [key, text] of Object.entries(NARRATION)) {
    const file = join(narrationDir, `${key}.wav`);
    await tts(text, "af_heart", file);
    files[key] = { file, duration: duration(file) };
  }

  const inAppDir = join(buildDir, "inapp");
  mkdirSync(inAppDir, { recursive: true });
  const warning = (snapshot.interventions ?? []).find((entry) => entry.kind === "warn");
  const inApp = [];
  if (warning) {
    const file = join(inAppDir, "guardian.wav");
    const hindi = String(warning.text).split(" (")[0] ?? warning.text;
    await tts(hindi.slice(0, 400), "hf_alpha", file);
    inApp.push({ role: "guardian", file, duration: duration(file), ts: warning.ts });
  }
  const decoys = (snapshot.utterances ?? []).filter((utterance) => utterance.speaker === "decoy");
  for (let i = 0; i < decoys.length; i += 1) {
    const decoy = decoys[i];
    const file = join(inAppDir, `decoy-${i}.wav`);
    await tts(String(decoy.text).slice(0, 400), "hf_beta", file);
    inApp.push({ role: "decoy", file, duration: duration(file), ts: decoy.ts });
  }
  return { narration: files, inApp };
}

function demoDurationSeconds() {
  return (meta.timeline ?? []).reduce((sum, value) => sum + Number(value), 0);
}

async function main() {
  console.log("generating narration and voices…");
  writeCards();
  const { narration, inApp } = await generateVoices();

  const demoDur = demoDurationSeconds();
  const callOffsetMs = Math.max(0, meta.clickTime + 400 - videoStartMs);
  const callTrimMs = Math.max(0, videoStartMs - meta.clickTime - 400);

  // Narration inside the demo segment, in playback order.
  const warnTs = (snapshot.interventions ?? []).find((entry) => entry.kind === "warn")?.ts;
  const lastUtterance = (snapshot.utterances ?? []).at(-1)?.ts;
  const tourMarks = meta.tourMarks ?? {};

  // The guardian voice is diegetic and stays at its real moment. The counter-
  // agent voices use only the first two lines, and every narration is placed
  // sequentially so no two voices ever overlap.
  const guardian = inApp.filter((line) => line.role === "guardian").sort((a, b) => a.ts - b.ts)[0];
  const decoys = inApp.filter((line) => line.role === "decoy").sort((a, b) => a.ts - b.ts).slice(0, 2);
  const voiceTrack = [];

  {
    const entry = narration.early;
    voiceTrack.push({ file: entry.file, startSec: 1.2, duration: entry.duration, role: "narration:early" });
  }
  if (guardian) {
    const start = Math.max(0.5, (guardian.ts - videoStartMs) / 1000);
    voiceTrack.push({ file: guardian.file, startSec: start, duration: guardian.duration, role: "guardian" });
  }
  let cursor = voiceTrack.reduce((max, line) => Math.max(max, line.startSec + line.duration), 0);

  const placeSequential = (key, intended) => {
    const entry = narration[key];
    const start = Math.max(intended ?? 0, cursor + 0.3);
    voiceTrack.push({ file: entry.file, startSec: start, duration: entry.duration, role: `narration:${key}` });
    cursor = start + entry.duration;
    return start;
  };

  placeSequential("warning", warnTs ? Math.max(2, (warnTs - videoStartMs) / 1000) : undefined);
  for (const decoy of decoys) {
    const start = Math.max((decoy.ts - videoStartMs) / 1000, cursor + 0.3);
    voiceTrack.push({ file: decoy.file, startSec: start, duration: decoy.duration, role: "decoy" });
    cursor = start + decoy.duration;
  }
  placeSequential("callEnded", lastUtterance ? (lastUtterance - videoStartMs) / 1000 + 2 : undefined);
  placeSequential("recovery", tourMarks.evidence ? (tourMarks.evidence - videoStartMs) / 1000 + 0.8 : undefined);
  placeSequential("identifiers", undefined);
  placeSequential("genome", tourMarks.genome ? (tourMarks.genome - videoStartMs) / 1000 + 0.8 : undefined);
  const closingStart = placeSequential("closing", Math.max(0, demoDur + 2));
  const lastVoiceEnd = voiceTrack.reduce((max, line) => Math.max(max, line.startSec + line.duration), closingStart);

  voiceTrack.sort((a, b) => a.startSec - b.startSec);
  const overlapsFound = voiceTrack.filter((line, index) => {
    const next = voiceTrack[index + 1];
    return next && line.startSec + line.duration > next.startSec + 0.05;
  });
  console.log(
    `voices: ${voiceTrack.map((line) => `${line.role}@${line.startSec.toFixed(1)}`).join(" ")}`
  );
  console.log(`voice overlaps: ${overlapsFound.length === 0 ? "none" : overlapsFound.map((l) => l.role).join(", ")}`);
  const demoTotal = Math.max(demoDur, lastVoiceEnd + 1.5);

  // Duck the call audio under every voice line.
  const duckIntervals = voiceTrack.map((line) => [line.startSec - 0.15, line.startSec + line.duration + 0.25]);
  const duckExpr = duckIntervals.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join("+");

  // Assemble the demo segment audio.
  const args = ["-i", join(root, "public", "demo", "call-digital-arrest.mp3")];
  for (const line of voiceTrack) args.push("-i", line.file);
  const filters = [];
  const callChain = callTrimMs > 0
    ? `atrim=start=${(callTrimMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,adelay=${callOffsetMs}|${callOffsetMs}`
    : `adelay=${callOffsetMs}|${callOffsetMs}`;
  filters.push(`[0:a]${callChain},volume=0.16:enable='${duckExpr}'[call]`);
  const mixInputs = ["[call]"];
  voiceTrack.forEach((line, index) => {
    const delayMs = Math.round(line.startSec * 1000);
    filters.push(`[${index + 1}:a]adelay=${delayMs}|${delayMs},volume=1.5[v${index}]`);
    mixInputs.push(`[v${index}]`);
  });
  filters.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:normalize=0,alimiter=limit=0.95[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-codec:a", "libmp3lame", "-b:a", "160k", join(buildDir, "demo-audio.mp3"));
  console.log(`mixing ${voiceTrack.length} voice lines with ducking…`);
  ffmpeg(args);

  // Encode the demo segment.
  const framesList = join(buildDir, "frames.txt");
  const frameLines = [];
  for (let i = 0; i < (meta.timeline ?? []).length; i += 1) {
    frameLines.push(`file '${join(workDir, "frames", `frame-${String(i + 1).padStart(6, "0")}.jpg`)}'`);
    frameLines.push(`duration ${meta.timeline[i]}`);
  }
  const lastFrame = `frame-${String((meta.timeline ?? []).length).padStart(6, "0")}.jpg`;
  frameLines.push(`file '${join(workDir, "frames", lastFrame)}'`);
  writeFileSync(framesList, frameLines.join("\n"));
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", framesList,
    "-i", join(buildDir, "demo-audio.mp3"),
    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2,scale=1280:-2,fps=12",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "144k",
    "-af", `apad=whole_dur=${(demoTotal + 0.5).toFixed(2)}`,
    "-t", demoTotal.toFixed(2),
    join(buildDir, "demo.mp4")
  ]);

  // Intro and outro cards.
  const makeCardSegment = (name, audioFile, minSeconds) => {
    const audioDur = duration(audioFile) + 1.6;
    const total = Math.max(minSeconds, audioDur);
    ffmpeg([
      "-loop", "1", "-i", join(buildDir, `${name}.png`),
      "-i", audioFile,
      "-f", "lavfi", "-t", String(total), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex", "[1:a]adelay=600|600,apad[a1];[2:a][a1]amix=inputs=2:duration=longest:normalize=0[aout]",
      "-map", "0:v", "-map", "[aout]",
      "-vf", "scale=1280:-2,fps=12,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
      "-c:a", "aac", "-b:a", "144k",
      "-t", total.toFixed(2),
      join(buildDir, `${name}.mp4`)
    ]);
  };
  makeCardSegment("title", narration.intro.file, 16);
  makeCardSegment("outro", narration.outro.file, 14);

  const concatFile = join(buildDir, "concat.txt");
  writeFileSync(
    concatFile,
    [join(buildDir, "title.mp4"), join(buildDir, "demo.mp4"), join(buildDir, "outro.mp4")]
      .map((file) => `file '${file}'`)
      .join("\n")
  );
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", concatFile,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "144k",
    outFile
  ]);

  rmSync(buildDir, { recursive: true, force: true });
  console.log(`final video: ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
