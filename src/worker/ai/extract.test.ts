import { describe, expect, it } from "vitest";
import { extractIdentifiers, normalizeSpokenIdentifiers } from "./extract";
import { ruleClassify } from "./classifier";
import type { Utterance } from "../../shared/types";
import { parseJsonLoose } from "../utils";

function utterance(text: string, speaker: Utterance["speaker"] = "unknown"): Utterance {
  return { id: `u${Math.random()}`, sessionId: "test", speaker, text, ts: Date.now(), confidence: 1, final: true };
}

describe("parseJsonLoose", () => {
  it("parses clean json", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it("repairs the missing opening brace quirk", () => {
    expect(parseJsonLoose('"family": "digital_arrest", "severity": 70}')).toEqual({
      family: "digital_arrest",
      severity: 70
    });
  });
  it("strips markdown fences", () => {
    expect(parseJsonLoose('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it("returns null for garbage", () => {
    expect(parseJsonLoose("not json at all")).toBeNull();
  });
});

describe("normalizeSpokenIdentifiers", () => {
  it("joins spaced digit sequences", () => {
    expect(normalizeSpokenIdentifiers("5 0 4 1 2 2 3 3 9 9 1 0")).toBe("504122339910");
  });
  it("joins comma separated digits", () => {
    expect(normalizeSpokenIdentifiers("5, 0, 4, 1, 2, 2, 3, 3, 9, 9, 1, 0")).toBe("504122339910");
  });
  it("joins grouped digits", () => {
    expect(normalizeSpokenIdentifiers("account 5041 2233 9910 please")).toContain("504122339910");
  });
  it("converts spoken UPI handles", () => {
    expect(normalizeSpokenIdentifiers("the UPI ID is verifycell at okaxis")).toContain("verifycell@okaxis");
  });
  it("converts spoken number words", () => {
    expect(
      normalizeSpokenIdentifiers("the account number is five zero four one two two three three nine nine one zero")
    ).toContain("504122339910");
  });
  it("repairs slightly mis-heard UPI suffixes", () => {
    expect(normalizeSpokenIdentifiers("UPI ID verificil at acaxes")).toContain("verificil@okaxis");
  });
  it("leaves normal text alone", () => {
    expect(normalizeSpokenIdentifiers("Call me tomorrow morning")).toBe("Call me tomorrow morning");
  });
});

describe("extractIdentifiers", () => {
  it("finds account number and UPI from a spoken line", () => {
    const identifiers = extractIdentifiers(
      "s1",
      "Account number 5 0 4 1 2 2 3 3 9 9 1 0. And the UPI ID is verifycell at okaxis."
    );
    expect(identifiers.some((i) => i.type === "account" && i.value === "504122339910")).toBe(true);
    expect(identifiers.some((i) => i.type === "upi" && i.value === "verifycell@okaxis")).toBe(true);
  });
  it("finds phones but not years", () => {
    const identifiers = extractIdentifiers("s1", "Call 9876543210, not 2019.");
    expect(identifiers.some((i) => i.type === "phone" && i.value === "9876543210")).toBe(true);
    expect(identifiers.some((i) => i.type === "phone" && i.value === "2019")).toBe(false);
  });
  it("ignores email domains", () => {
    const identifiers = extractIdentifiers("s1", "mail me at someone@gmail.com");
    expect(identifiers).toHaveLength(0);
  });
});

describe("ruleClassify", () => {
  it("flags digital arrest and reaches the deepest matched stage", () => {
    const result = ruleClassify([
      utterance("This is Inspector Sharma from the CBI. A case has been registered under your Aadhaar."),
      utterance("You are under digital arrest. Do not tell anyone or a warrant will be issued.")
    ]);
    expect(result.family).toBe("digital_arrest");
    expect(result.severity).toBeGreaterThanOrEqual(55);
    expect(["isolation", "accusation", "surveillance"]).toContain(result.stageId);
  });

  it("keeps benign calls safe", () => {
    const result = ruleClassify([
      utterance("Hello, this is Dr. Rao's clinic calling to confirm your appointment."),
      utterance("Yes, tomorrow at eleven for my father's checkup.")
    ]);
    expect(result.family).toBe("unknown");
    expect(result.severity).toBeLessThan(20);
  });

  it("detects voice clone emergency patterns", () => {
    const result = ruleClassify([
      utterance("Mom, I have been in an accident, I am in the hospital."),
      utterance("Please send money right now, scan this QR, don't call back.")
    ]);
    expect(result.family).toBe("voice_clone_emergency");
  });
});
