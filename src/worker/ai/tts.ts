import type { Env } from "../env";

export interface SpeechResult {
  audio: ArrayBuffer;
  format: "mp3" | "wav";
  model: string;
  voice: string;
  latencyMs: number;
  fallback: boolean;
}

export type VoiceRole = "guardian" | "decoy";

function selectVoice(env: Env, role: VoiceRole, language: "en" | "hi"): string {
  if (language === "hi") {
    return role === "guardian" ? env.FEATHERLESS_TTS_VOICE_GUARDIAN : env.FEATHERLESS_TTS_VOICE_DECOY;
  }
  return role === "guardian" ? "af_heart" : "af_nova";
}

export async function speak(
  env: Env,
  text: string,
  role: VoiceRole,
  language: "en" | "hi"
): Promise<SpeechResult> {
  const voice = selectVoice(env, role, language);
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(`${env.FEATHERLESS_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FEATHERLESS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.FEATHERLESS_TTS_MODEL,
        input: text,
        voice,
        response_format: "mp3",
        delivery: "bulk",
        encoding: "binary"
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "audio/mpeg";
    const audio = await res.arrayBuffer();
    if (audio.byteLength < 1000) throw new Error("tts audio too small");
    return {
      audio,
      format: contentType.includes("wav") ? "wav" : "mp3",
      model: env.FEATHERLESS_TTS_MODEL,
      voice,
      latencyMs: Date.now() - started,
      fallback: false
    };
  } catch {
    const { WorkersAITTS } = await import("agents/voice");
    const provider = new WorkersAITTS(env.AI, { speaker: "asteria" });
    const audio = await provider.synthesize(text);
    if (!audio) throw new Error("all tts providers failed");
    return {
      audio,
      format: "mp3",
      model: "@cf/deepgram/aura-1",
      voice: "asteria",
      latencyMs: Date.now() - started,
      fallback: true
    };
  }
}
