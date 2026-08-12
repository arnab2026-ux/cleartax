import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blindIndexEquals, isValidPan, normalisePan, panBlindIndex } from "../lib/blindIndex";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

const original = process.env["PAN_BLIND_INDEX_KEY"];

beforeEach(() => {
  process.env["PAN_BLIND_INDEX_KEY"] = KEY_A;
});

afterEach(() => {
  if (original === undefined) delete process.env["PAN_BLIND_INDEX_KEY"];
  else process.env["PAN_BLIND_INDEX_KEY"] = original;
});

describe("normalisePan", () => {
  it("uppercases and strips whitespace", () => {
    expect(normalisePan(" abcde1234f ")).toBe("ABCDE1234F");
    expect(normalisePan("ABCDE 1234 F")).toBe("ABCDE1234F");
  });
});

describe("isValidPan", () => {
  it("accepts the five-letters/four-digits/letter shape", () => {
    expect(isValidPan("ABCDE1234F")).toBe(true);
    expect(isValidPan("abcde1234f")).toBe(true); // normalised first
  });

  it("rejects near-misses", () => {
    expect(isValidPan("ABCD1234F")).toBe(false); // 4 leading letters
    expect(isValidPan("ABCDE12345")).toBe(false); // trailing digit, not letter
    expect(isValidPan("ABCDE1234")).toBe(false); // too short
    expect(isValidPan("ABCDE1234FG")).toBe(false); // too long
    expect(isValidPan("")).toBe(false);
  });
});

describe("panBlindIndex", () => {
  it("is deterministic — the property the unique constraint depends on", () => {
    expect(panBlindIndex("ABCDE1234F")).toBe(panBlindIndex("ABCDE1234F"));
  });

  it("collapses casing and spacing, so one PAN cannot register twice", () => {
    // This is a security property, not a convenience: if these differed, the
    // unique index would happily accept both and the duplicate-PAN check
    // would be worthless.
    const canonical = panBlindIndex("ABCDE1234F");
    expect(panBlindIndex("abcde1234f")).toBe(canonical);
    expect(panBlindIndex("  ABCDE1234F  ")).toBe(canonical);
    expect(panBlindIndex("ABCDE 1234 F")).toBe(canonical);
  });

  it("distinguishes different PANs", () => {
    expect(panBlindIndex("ABCDE1234F")).not.toBe(panBlindIndex("ABCDE1234G"));
  });

  it("never returns the PAN itself, in any encoding", () => {
    const digest = panBlindIndex("ABCDE1234F");
    expect(digest).toMatch(/^[0-9a-f]{64}$/); // hex SHA-256
    expect(digest).not.toContain("ABCDE1234F");
    expect(Buffer.from(digest, "hex").toString("utf8")).not.toContain("ABCDE1234F");
  });

  it("produces a different digest under a different key", () => {
    // Rotating the key must invalidate old digests rather than silently
    // continuing to match — otherwise rotation would be a no-op.
    const underA = panBlindIndex("ABCDE1234F");
    process.env["PAN_BLIND_INDEX_KEY"] = KEY_B;
    expect(panBlindIndex("ABCDE1234F")).not.toBe(underA);
  });

  it("refuses to hash a malformed PAN rather than occupying the unique index with junk", () => {
    expect(() => panBlindIndex("NOTAPAN")).toThrow(/not a valid PAN/);
  });

  it("fails loudly when the key is missing", () => {
    delete process.env["PAN_BLIND_INDEX_KEY"];
    expect(() => panBlindIndex("ABCDE1234F")).toThrow(/PAN_BLIND_INDEX_KEY is not set/);
  });

  it("rejects a key that is not base64, rather than letting Node decode it leniently", () => {
    process.env["PAN_BLIND_INDEX_KEY"] = "not valid base64!!!";
    expect(() => panBlindIndex("ABCDE1234F")).toThrow(/not valid base64/);
  });

  it("rejects a key shorter than 32 bytes", () => {
    process.env["PAN_BLIND_INDEX_KEY"] = Buffer.alloc(16, 9).toString("base64");
    expect(() => panBlindIndex("ABCDE1234F")).toThrow(/at least 32 are required/);
  });
});

describe("blindIndexEquals", () => {
  it("matches equal digests and rejects different ones", () => {
    const a = panBlindIndex("ABCDE1234F");
    expect(blindIndexEquals(a, panBlindIndex("abcde1234f"))).toBe(true);
    expect(blindIndexEquals(a, panBlindIndex("ABCDE1234G"))).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    expect(blindIndexEquals(panBlindIndex("ABCDE1234F"), "abcd")).toBe(false);
  });
});
