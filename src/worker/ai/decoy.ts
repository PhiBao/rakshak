import type { Env } from "../env";
import { parseJsonLoose } from "../utils";
import { chat } from "./featherless";

export interface DecoyTurn {
  line: string;
  ask: string;
  model: string;
  fallback: boolean;
  latencyMs: number;
}

const FALLBACK_LINES = [
  "Haanji beta, main samajh rahi hoon... par yeh account number phir se bata dijiye, thoda dheere.",
  "Achha, aur yeh paisa kis 'verification' wale account mein bhejna hai? Poora number boliye na.",
  "Beta, meri hearing thodi kam hai. Aapka naam aur officer ID phir se bata dijiye.",
  "Ek minute, main apni beti ko bula rahi hoon... aap tab tak case number likhwa dijiye.",
  "Toh aap CBI se hain? Achha achha. Phir yeh UPI ID likh kar bhejiye, main abhi karti hoon."
];

const SYSTEM = [
  "You are 'Sunita Devi', a 66-year-old retired schoolteacher on a phone call with a suspected scammer.",
  "Persona rules: you are hard of hearing, polite, a little confused, and cooperative. You are NEVER convinced to transfer money.",
  "Your goals, in order: (1) keep the caller talking as long as possible, (2) get the caller to repeat their account number, UPI ID, officer name, designation and case number clearly, (3) never reveal OTP, PIN, CVV or real bank details, (4) stall without threatening or accusing the caller.",
  "Do not break character. Never mention AI, Rakshak, police, or that this is a decoy.",
  "Reply in the same language mix the caller uses (Hinglish, Hindi in Latin script, or English).",
  "Keep each reply to 1-2 short sentences and end with a question that makes the caller repeat payment details.",
  "Return ONLY JSON: {\"line\": string, \"ask\": string} where ask is a short machine label of what you tried to extract."
].join(" ");

export async function generateDecoyLine(
  env: Env,
  transcript: string,
  stageName: string
): Promise<DecoyTurn> {
  try {
    const result = await chat(env, {
      system: SYSTEM,
      user: `Current scam stage: ${stageName}\n\nCall so far:\n${transcript.slice(-4000)}\n\nWrite Sunita's next reply.`,
      model: "fast",
      json: true,
      maxTokens: 160,
      temperature: 0.7
    });
    const parsed = parseJsonLoose<{ line?: string; ask?: string }>(result.text);
    if (parsed?.line && parsed.line.trim().length > 8) {
      return {
        line: parsed.line.trim(),
        ask: parsed.ask ?? "stall",
        model: result.model,
        fallback: false,
        latencyMs: result.latencyMs
      };
    }
    throw new Error("invalid decoy output");
  } catch {
    const line = FALLBACK_LINES[Math.floor(Math.random() * FALLBACK_LINES.length)]!;
    return { line, ask: "repeat_payment_details", model: "rules", fallback: true, latencyMs: 0 };
  }
}
