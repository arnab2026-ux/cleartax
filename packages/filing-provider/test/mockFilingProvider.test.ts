import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACKNOWLEDGEMENT_DELAY_MS,
  decodeSubmittedAtMs,
  encodeAcknowledgementNumber,
  mockFilingProvider,
} from "../src/mockFilingProvider";
import type { EVerifyMethod, FilingMeta, FilingProvider } from "../src/types";

const VALID_META: FilingMeta = { assessmentYear: "2026-27", itrType: "ITR1" };

describe("mockFilingProvider — zero-network guarantee", () => {
  it("contains no fetch/http/XMLHttpRequest/networking code anywhere in its actual (non-comment) source", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const rawSource = readFileSync(join(here, "..", "src", "mockFilingProvider.ts"), "utf8");
    // Strip block and line comments first — the file's own doc comments
    // deliberately name several of these (e.g. "no fetch, no
    // XMLHttpRequest") to document the guarantee in prose, which would
    // otherwise trip this exact check. What actually matters is that none
    // of these appear in the real code.
    const codeOnly = rawSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["fetch(", "XMLHttpRequest", "http.request", "https.request", "axios", "child_process"]) {
      expect(codeOnly).not.toContain(forbidden);
    }
  });

  it("imports nothing beyond its own ./types module", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "..", "src", "mockFilingProvider.ts"), "utf8");
    const importLines = source.split("\n").filter((line) => line.trim().startsWith("import "));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toContain("./types");
  });
});

describe("mockFilingProvider — interface conformance", () => {
  it("satisfies the FilingProvider interface shape", () => {
    const provider: FilingProvider = mockFilingProvider;
    expect(typeof provider.submitReturn).toBe("function");
    expect(typeof provider.checkStatus).toBe("function");
    expect(typeof provider.eVerify).toBe("function");
  });
});

describe("encodeAcknowledgementNumber / decodeSubmittedAtMs", () => {
  const roundTripCases = [0, 1, 1_753_900_000_000, 9_999_999_999_999];

  it.each(roundTripCases)("round-trips timestamp %i through encode -> decode", (ts) => {
    const ack = encodeAcknowledgementNumber(ts);
    expect(decodeSubmittedAtMs(ack)).toBe(ts);
  });

  it("always produces a MOCK-prefixed, digit-heavy string distinguishable from a real 15-digit ack number", () => {
    const ack = encodeAcknowledgementNumber(Date.now());
    expect(ack.startsWith("MOCK")).toBe(true);
    expect(ack).toMatch(/^MOCK\d{19}$/);
  });

  const malformedCases: Array<[string, string]> = [
    ["empty string", ""],
    ["real-looking 15-digit ITR-V number (no MOCK prefix)", "531951460281123"],
    ["wrong prefix", "REAL0000000000123000000"],
    ["too few digits after prefix", "MOCK123"],
    ["lowercase prefix", "mock0000000000000000000"],
  ];

  it.each(malformedCases)("decodeSubmittedAtMs returns null for: %s", (_label, input) => {
    expect(decodeSubmittedAtMs(input)).toBeNull();
  });
});

describe("mockFilingProvider.submitReturn", () => {
  it("returns a SUBMITTED result with a well-formed ack number and a single-event history", async () => {
    const result = await mockFilingProvider.submitReturn({ some: "itr json" }, VALID_META);
    expect(result.status).toBe("SUBMITTED");
    expect(decodeSubmittedAtMs(result.acknowledgementNumber)).not.toBeNull();
    expect(result.statusHistory).toHaveLength(1);
    expect(result.statusHistory[0]?.status).toBe("SUBMITTED");
    expect(result.statusHistory[0]?.detail.toLowerCase()).toContain("simulation");
  });

  it("generates a different acknowledgement number on each call", async () => {
    const a = await mockFilingProvider.submitReturn({}, VALID_META);
    const b = await mockFilingProvider.submitReturn({}, VALID_META);
    expect(a.acknowledgementNumber).not.toBe(b.acknowledgementNumber);
  });

  const invalidInputCases: Array<[string, unknown, FilingMeta]> = [
    ["null itrJson", null, VALID_META],
    ["undefined itrJson", undefined, VALID_META],
    ["missing assessmentYear", {}, { assessmentYear: "", itrType: "ITR1" }],
    ["missing itrType", {}, { assessmentYear: "2026-27", itrType: "" as unknown as "ITR1" }],
  ];

  it.each(invalidInputCases)("rejects: %s", async (_label, itrJson, meta) => {
    await expect(mockFilingProvider.submitReturn(itrJson, meta)).rejects.toThrow();
  });
});

describe("mockFilingProvider.checkStatus — state machine", () => {
  it("reports SUBMITTED immediately after a fresh ack number", async () => {
    const ack = encodeAcknowledgementNumber(Date.now());
    const result = await mockFilingProvider.checkStatus(ack);
    expect(result.status).toBe("SUBMITTED");
    expect(result.event.status).toBe("SUBMITTED");
  });

  it("reports SUBMITTED just below the acknowledgement delay boundary", async () => {
    const ack = encodeAcknowledgementNumber(Date.now() - (ACKNOWLEDGEMENT_DELAY_MS - 1));
    const result = await mockFilingProvider.checkStatus(ack);
    expect(result.status).toBe("SUBMITTED");
  });

  it("reports ACKNOWLEDGED exactly at the acknowledgement delay boundary", async () => {
    const ack = encodeAcknowledgementNumber(Date.now() - ACKNOWLEDGEMENT_DELAY_MS);
    const result = await mockFilingProvider.checkStatus(ack);
    expect(result.status).toBe("ACKNOWLEDGED");
  });

  it("reports ACKNOWLEDGED well past the acknowledgement delay", async () => {
    const ack = encodeAcknowledgementNumber(Date.now() - ACKNOWLEDGEMENT_DELAY_MS * 10);
    const result = await mockFilingProvider.checkStatus(ack);
    expect(result.status).toBe("ACKNOWLEDGED");
    expect(result.event.detail.toLowerCase()).toContain("simulation");
  });

  it("reports FAILED for a malformed/unrecognized acknowledgement number", async () => {
    const result = await mockFilingProvider.checkStatus("not-a-real-ack-number");
    expect(result.status).toBe("FAILED");
    expect(result.event.status).toBe("FAILED");
  });

  it("event.at is a valid ISO timestamp close to now", async () => {
    const before = Date.now();
    const ack = encodeAcknowledgementNumber(before);
    const result = await mockFilingProvider.checkStatus(ack);
    const eventMs = new Date(result.event.at).getTime();
    expect(eventMs).toBeGreaterThanOrEqual(before);
    expect(eventMs).toBeLessThan(before + 5_000);
  });
});

describe("mockFilingProvider.eVerify — state machine", () => {
  it("fails (success: false) when the return is still only SUBMITTED (too soon to verify)", async () => {
    const ack = encodeAcknowledgementNumber(Date.now());
    const result = await mockFilingProvider.eVerify(ack, "AADHAAR_OTP");
    expect(result.success).toBe(false);
    expect(result.status).toBe("SUBMITTED");
  });

  const successCases: EVerifyMethod[] = ["AADHAAR_OTP", "NET_BANKING"];

  it.each(successCases)("succeeds (-> VERIFIED) once ACKNOWLEDGED, via %s", async (method) => {
    const ack = encodeAcknowledgementNumber(Date.now() - ACKNOWLEDGEMENT_DELAY_MS * 2);
    const result = await mockFilingProvider.eVerify(ack, method);
    expect(result.success).toBe(true);
    expect(result.status).toBe("VERIFIED");
    expect(result.event.status).toBe("VERIFIED");
  });

  it("mentions Aadhaar OTP specifically in the event detail for that method", async () => {
    const ack = encodeAcknowledgementNumber(Date.now() - ACKNOWLEDGEMENT_DELAY_MS * 2);
    const result = await mockFilingProvider.eVerify(ack, "AADHAAR_OTP");
    expect(result.event.detail.toLowerCase()).toContain("aadhaar");
  });

  it("mentions net banking specifically in the event detail for that method", async () => {
    const ack = encodeAcknowledgementNumber(Date.now() - ACKNOWLEDGEMENT_DELAY_MS * 2);
    const result = await mockFilingProvider.eVerify(ack, "NET_BANKING");
    expect(result.event.detail.toLowerCase()).toContain("net banking");
  });

  it("fails with status FAILED for a malformed acknowledgement number", async () => {
    const result = await mockFilingProvider.eVerify("garbage", "AADHAAR_OTP");
    expect(result.success).toBe(false);
    expect(result.status).toBe("FAILED");
  });

  it("throws for an unsupported method string", async () => {
    const ack = encodeAcknowledgementNumber(Date.now() - ACKNOWLEDGEMENT_DELAY_MS * 2);
    await expect(mockFilingProvider.eVerify(ack, "SOMETHING_ELSE" as unknown as EVerifyMethod)).rejects.toThrow();
  });

  it("every simulated event/detail across submit/check/verify says 'simulation' or 'simulated' so no output can be mistaken for a real confirmation", async () => {
    const submitted = await mockFilingProvider.submitReturn({}, VALID_META);
    const backdatedAck = encodeAcknowledgementNumber(Date.now() - ACKNOWLEDGEMENT_DELAY_MS * 2);
    const checked = await mockFilingProvider.checkStatus(backdatedAck);
    const verified = await mockFilingProvider.eVerify(backdatedAck, "AADHAAR_OTP");

    for (const detail of [submitted.statusHistory[0]?.detail, checked.event.detail, verified.event.detail]) {
      expect(detail?.toLowerCase()).toMatch(/simulat/);
    }
  });
});
