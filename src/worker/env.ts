import type { CallAgent } from "./call-agent";
import type { GenomeAgent } from "./genome-agent";

export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  CallAgent: DurableObjectNamespace<CallAgent>;
  GenomeAgent: DurableObjectNamespace<GenomeAgent>;
  FEATHERLESS_API_KEY: string;
  FEATHERLESS_BASE_URL: string;
  FEATHERLESS_MODEL_FAST: string;
  FEATHERLESS_MODEL_STRONG: string;
  FEATHERLESS_TTS_MODEL: string;
  FEATHERLESS_TTS_VOICE_GUARDIAN: string;
  FEATHERLESS_TTS_VOICE_DECOY: string;
  DEEPGRAM_API_KEY?: string;
}

export interface Ai {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}
