#!/usr/bin/env node
/**
 * Rebuilds the audio track for a recorded session from its snapshot:
 *  - places the bundled demo call at t=0
 *  - regenerates guardian/decoy TTS lines with the same Featherless voices
 *  - places each line at the wall-clock time it originally played
 *
 * Usage: node scripts/build-demo-audio.mjs <snapshot.json> <clickMs> <outMp3>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = process.argv[2];
const clickMs = Number(process.argv[3] ?? Date.now());
const outPath = process.argv[4] ?? join(root, "docs", "submission", "demo-audio.mp3");
const videoStartMs = Number(process.argv[5] ?? clickMs);

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

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const tempDir = join(root, ".demo-audio-tmp");
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

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
  if (!response.ok) throw new Error(`tts failed: ${response.status}`);
  writeFileSync(outFile, Buffer.from(await response.arrayBuffer()));
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

async function main() {
  const inputs = [];
  const delays = [];
  const trims = [];

  // The demo call audio starts ~0.4s after the click; trim the part that
  // played before the first video frame, then place it on the video timeline.
  const callStartOnVideo = Math.max(0, clickMs + 400 - videoStartMs);
  const trimMs = Math.max(0, videoStartMs - clickMs - 400);
  inputs.push(join(root, "public", "demo", "call-digital-arrest.mp3"));
  delays.push(callStartOnVideo);
  trims.push(trimMs);

  const warning = (snapshot.interventions ?? []).find((entry) => entry.kind === "warn");
  if (warning) {
    const file = join(tempDir, "guardian.wav");
    const hindi = String(warning.text).split(" (")[0] ?? warning.text;
    await tts(hindi.slice(0, 400), "hf_alpha", file);
    inputs.push(file);
    delays.push(Math.max(200, warning.ts - videoStartMs));
    trims.push(0);
  }

  const decoys = (snapshot.utterances ?? []).filter((utterance) => utterance.speaker === "decoy");
  for (let i = 0; i < decoys.length; i += 1) {
    const decoy = decoys[i];
    const file = join(tempDir, `decoy-${i}.wav`);
    await tts(String(decoy.text).slice(0, 400), "hf_beta", file);
    inputs.push(file);
    delays.push(Math.max(200, decoy.ts - videoStartMs));
    trims.push(0);
  }

  const args = [];
  for (const input of inputs) args.push("-i", input);
  const filters = inputs.map((_, index) => {
    const trim = trims[index] > 0 ? `atrim=start=${(trims[index] / 1000).toFixed(3)},asetpts=PTS-STARTPTS,` : "";
    return `[${index}:a]${trim}adelay=${delays[index]}|${delays[index]},volume=1.4[a${index}]`;
  });
  const mixInputs = inputs.map((_, index) => `[a${index}]`).join("");
  filters.push(`${mixInputs}amix=inputs=${inputs.length}:duration=longest:normalize=0,volume=0.9[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-codec:a", "libmp3lame", "-b:a", "128k", outPath);

  console.log(`mixing ${inputs.length} audio sources (${decoys.length} decoy lines, guardian=${Boolean(warning)})`);
  ffmpeg(args);
  rmSync(tempDir, { recursive: true, force: true });
  console.log(`audio written: ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
