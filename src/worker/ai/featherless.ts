import type { Env } from "../env";

export interface LlmResult {
  text: string;
  model: string;
  latencyMs: number;
  fallback: boolean;
}

export interface ChatOptions {
  system: string;
  user: string;
  model?: "fast" | "strong";
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const FALLBACK_MODELS = [
  "@cf/openai/gpt-oss-120b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
];

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  if (typeof p.response === "string") return p.response;
  const choices = p.choices as Array<{ message?: { content?: string } }> | undefined;
  if (choices?.[0]?.message?.content) return choices[0].message.content;
  const result = p.result as { response?: string } | undefined;
  if (result?.response) return result.response;
  return "";
}

async function callFeatherless(env: Env, opts: ChatOptions, messages: ChatMessage[]): Promise<LlmResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  const started = Date.now();
  try {
    const model = opts.model === "strong" ? env.FEATHERLESS_MODEL_STRONG : env.FEATHERLESS_MODEL_FAST;
    const res = await fetch(`${env.FEATHERLESS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FEATHERLESS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 400,
        ...(opts.json ? { response_format: { type: "json_object" } } : {})
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`featherless ${res.status}: ${body.slice(0, 200)}`);
    }
    const payload = await res.json();
    const text = extractText(payload);
    if (!text) throw new Error("featherless empty response");
    return { text, model, latencyMs: Date.now() - started, fallback: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function callWorkersAi(env: Env, opts: ChatOptions, messages: ChatMessage[]): Promise<LlmResult> {
  const started = Date.now();
  let lastError: unknown = null;
  for (const model of FALLBACK_MODELS) {
    try {
      const payload = await env.AI.run(model, {
        messages,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 400
      });
      const text = extractText(payload);
      if (text) return { text, model, latencyMs: Date.now() - started, fallback: true };
      lastError = new Error("workiers ai empty response");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("workers ai fallback failed");
}

export async function chat(env: Env, opts: ChatOptions): Promise<LlmResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user }
  ];
  try {
    return await callFeatherless(env, opts, messages);
  } catch {
    return await callWorkersAi(env, opts, messages);
  }
}
