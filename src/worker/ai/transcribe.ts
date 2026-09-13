import type { Env } from "../env";

const SAMPLE_RATE = 16000;

export interface TranscriptionResult {
  text: string;
  model: string;
  latencyMs: number;
  fallback: boolean;
}

/** Wraps raw PCM16 mono audio in a WAV container for batch transcription. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  // A little leading silence helps batch engines avoid clipping the first word
  // when a chunk begins mid-speech.
  const padSamples = Math.floor(sampleRate * 0.3);
  const padBytes = padSamples * 2;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength + padBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcm.byteLength + padBytes, true);
  const wav = new Uint8Array(44 + padBytes + pcm.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44 + padBytes);
  return wav.buffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const BATCH_MODELS = ["@cf/openai/whisper-large-v3-turbo", "@cf/openai/whisper"];

async function transcribeWithDeepgram(env: Env, wav: ArrayBuffer, language: string): Promise<TranscriptionResult> {
  const started = Date.now();
  if (!env.DEEPGRAM_API_KEY) throw new Error("no deepgram key");
  const params = new URLSearchParams({
    model: "nova-3",
    // smart_format converts spoken digit sequences into times/dates (e.g.
    // "05:04"), which breaks identifier capture. Keep raw words instead.
    smart_format: "false",
    punctuate: "true",
    language
  });
  for (const keyterm of [
    "verifycell",
    "okaxis",
    "verification account",
    "digital arrest",
    "CBI",
    "money laundering",
    "Aadhaar",
    "UPI ID",
    "non bailable warrant"
  ]) {
    params.append("keyterm", keyterm);
  }
  const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      "Content-Type": "audio/wav"
    },
    body: wav
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`deepgram ${response.status}: ${detail.slice(0, 160)}`);
  }
  const payload = (await response.json()) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
  };
  const text = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  if (!text) throw new Error("deepgram returned empty transcript");
  return { text, model: "deepgram/nova-3", latencyMs: Date.now() - started, fallback: false };
}

/**
 * Batch transcription. Deepgram Nova-3 is the primary provider (streaming and
 * batch), with Workers AI Whisper as a quota-limited fallback.
 */
export async function transcribePcm(
  env: Env,
  pcm: Uint8Array,
  language: "en" | "hi" = "en"
): Promise<TranscriptionResult> {
  const started = Date.now();
  const wav = pcm16ToWav(pcm);

  if (env.DEEPGRAM_API_KEY) {
    try {
      return await transcribeWithDeepgram(env, wav, language);
    } catch (error) {
      if (!String(error).includes("no deepgram key")) {
        // Fall through to Workers AI only after a real provider error.
      }
    }
  }

  const bytes = new Uint8Array(wav);
  const base64 = toBase64(bytes);
  let lastError: unknown = null;
  for (const model of BATCH_MODELS) {
    const variants: Array<Record<string, unknown>> = [{ audio: base64 }, { audio: Array.from(bytes) }];
    for (const input of variants) {
      try {
        const result = (await env.AI.run(model, input)) as { text?: string } | undefined;
        const text = (result?.text ?? "").trim();
        if (text) return { text, model, latencyMs: Date.now() - started, fallback: true };
        lastError = new Error("whisper returned empty text");
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("batch transcription failed");
}
