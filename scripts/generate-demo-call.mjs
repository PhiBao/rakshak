#!/usr/bin/env node
/**
 * Generates the synthetic demo scam call with Featherless TTS and assembles it
 * with ffmpeg. Run: node scripts/generate-demo-call.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(root, "data", "demo-calls", "digital-arrest.script.json");
const outDir = join(root, "public", "demo");
const tmpDir = join(root, ".demo-tmp");

function loadEnv() {
  const envPath = join(root, ".env");
  const values = {};
  if (!existsSync(envPath)) return values;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const env = loadEnv();
const apiKey = process.env.FEATHERLESS_API_KEY ?? env.OPENAI_COMPAT_API_KEY;
const baseUrl = process.env.FEATHERLESS_BASE_URL ?? env.OPENAI_COMPAT_BASE_URL ?? "https://api.featherless.ai/v1";
if (!apiKey) {
  console.error("Missing Featherless API key (OPENAI_COMPAT_API_KEY in .env)");
  process.exit(1);
}

async function tts(text, voice, outFile) {
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "hexgrad/Kokoro-82M",
      input: text,
      voice,
      response_format: "wav",
      delivery: "bulk",
      encoding: "binary"
    })
  });
  if (!response.ok) throw new Error(`TTS failed for "${text.slice(0, 40)}...": ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outFile, buffer);
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

async function main() {
  const script = JSON.parse(readFileSync(scriptPath, "utf8"));
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const concatEntries = [];
  let groundTruth = [];

  for (let i = 0; i < script.lines.length; i += 1) {
    const line = script.lines[i];
    const voice = script.voices[line.speaker] ?? "am_michael";
    const rawFile = join(tmpDir, `line-${String(i).padStart(2, "0")}-raw.bin`);
    const normalizedFile = join(tmpDir, `line-${String(i).padStart(2, "0")}-norm.wav`);
    const paddedFile = join(tmpDir, `line-${String(i).padStart(2, "0")}.wav`);
    process.stdout.write(`[${i + 1}/${script.lines.length}] ${line.speaker}: ${line.text.slice(0, 60)}...\n`);
    await tts(line.text, voice, rawFile);

    ffmpeg(["-i", rawFile, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", normalizedFile]);

    const pauseSeconds = (line.pauseAfterMs ?? 600) / 1000;
    ffmpeg([
      "-i",
      normalizedFile,
      "-af",
      `apad=pad_dur=${pauseSeconds}`,
      paddedFile
    ]);
    const duration = Number(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        paddedFile
      ])
        .toString()
        .trim()
    );
    concatEntries.push(paddedFile);
    groundTruth.push({
      index: i,
      speaker: line.speaker,
      text: line.text,
      startSec: groundTruth.length ? groundTruth[groundTruth.length - 1].endSec : 0,
      endSec: (groundTruth.length ? groundTruth[groundTruth.length - 1].endSec : 0) + duration
    });
  }

  const listFile = join(tmpDir, "concat.txt");
  writeFileSync(listFile, concatEntries.map((file) => `file '${file}'`).join("\n"));

  const mergedWav = join(tmpDir, "merged.wav");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", mergedWav]);

  const outMp3 = join(outDir, "call-digital-arrest.mp3");
  ffmpeg(["-i", mergedWav, "-codec:a", "libmp3lame", "-b:a", "64k", outMp3]);

  const total = groundTruth[groundTruth.length - 1]?.endSec ?? 0;
  writeFileSync(
    join(outDir, "call-digital-arrest.json"),
    JSON.stringify(
      {
        totalSec: total,
        voices: script.voices,
        expectedStages: script.expectedStages,
        disclaimer: script.disclaimer,
        lines: groundTruth
      },
      null,
      2
    )
  );

  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`\nDone. ${outMp3} (${total.toFixed(1)}s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
