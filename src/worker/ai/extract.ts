import { newId } from "../utils";
import type { Identifier } from "../../shared/types";

const EMAIL_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "rediffmail.com"]);
const UPI_SUFFIXES = new Set([
  "okaxis",
  "okhdfcbank",
  "okicici",
  "oksbi",
  "ybl",
  "paytm",
  "ibl",
  "axl",
  "apl",
  "upi",
  "airtel",
  "jio",
  "axisbank",
  "hdfcbank",
  "icici",
  "sbi"
]);

export function extractIdentifiers(sessionId: string, text: string): Identifier[] {
  const found: Identifier[] = [];
  const seen = new Set<string>();
  const normalized = normalizeSpokenIdentifiers(text);
  const push = (type: Identifier["type"], value: string, display = value) => {
    const key = `${type}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ id: newId("id"), sessionId, ts: Date.now(), type, value, display });
  };

  const upiRegex = /[a-zA-Z0-9._-]{2,}@[a-zA-Z][a-zA-Z0-9]*/g;
  for (const match of normalized.matchAll(upiRegex)) {
    const value = match[0];
    const index = match.index ?? 0;
    const after = normalized.slice(index + value.length);
    if (/^\.(com|in|org|net|co|io|edu|gov)\b/i.test(after)) continue;
    const domain = value.split("@")[1]?.toLowerCase() ?? "";
    if (EMAIL_DOMAINS.has(domain)) continue;
    if (UPI_SUFFIXES.has(domain) || domain.length >= 3) push("upi", value.toLowerCase());
  }

  const phoneMatches = normalized.match(/(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g) ?? [];
  for (const match of phoneMatches) {
    const digits = match.replace(/\D/g, "");
    if (digits.length === 10 || (digits.length === 12 && digits.startsWith("91"))) push("phone", digits);
  }

  const accountMatches = normalized.match(/\b\d{9,18}\b/g) ?? [];
  for (const match of accountMatches) {
    if (match.length === 10 && /^[6-9]/.test(match)) continue;
    if (upirange(match)) continue;
    push("account", match, `${match.slice(0, 3)}****${match.slice(-3)}`);
  }

  const urlMatches = normalized.match(/https?:\/\/[^\s"']+/g) ?? [];
  for (const match of urlMatches) push("url", match.replace(/[),.]+$/, ""));

  return found;
}

export function normalizeSpokenIdentifiers(text: string): string {
  let out = text.replace(
    /\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s,.-]+(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)){8,}\b/gi,
    (match) => {
      const digits = match
        .toLowerCase()
        .split(/[\s,.-]+/)
        .map((word) => NUMBER_WORDS[word] ?? "")
        .join("");
      return digits.length >= 9 && digits.length <= 18 ? digits : match;
    }
  );
  out = out.replace(/\d(?:[\s,.-]{0,2}\d){8,}/g, (match) => {
    const digits = match.replace(/[\s,.-]/g, "");
    return digits.length >= 9 && digits.length <= 18 ? digits : match;
  });
  if (/\bupi\b|\bid\b|\baccount\b/i.test(out) || out.includes("@")) {
    out = out.replace(
      /\b([a-z0-9._-]{2,})\s+at\s+(okaxis|oksbi|okhdfcbank|okicici|ybl|paytm|ibl|axl|apl|upi|airtel|jio|axisbank|hdfcbank|icici|sbi)\b/gi,
      "$1@$2"
    );
    out = out.replace(/\b([a-z][a-z0-9._-]{2,})\s+at\s+([a-z][a-z0-9]{2,})\b/gi, (match, handle: string, domain: string) => {
      const corrected = nearestUpiDomain(domain.toLowerCase());
      return corrected ? `${handle}@${corrected}` : match;
    });
  }
  return out;
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9"
};

function nearestUpiDomain(candidate: string): string | null {
  let best: string | null = null;
  let bestDistance = 5;
  for (const suffix of UPI_SUFFIXES) {
    const distance = levenshtein(candidate, suffix);
    const shared = lcsLength(candidate, suffix);
    const acceptable = distance <= 3 || (distance <= 4 && shared >= 3);
    if (acceptable && distance < bestDistance) {
      bestDistance = distance;
      best = suffix;
    }
  }
  return best;
}

function lcsLength(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[b.length]!;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const temp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[cols - 1]!;
}

function upirange(value: string): boolean {
  return /^20\d{2}$/.test(value);
}
