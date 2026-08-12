import { describe, expect, it } from "vitest";
import { loginSchema, registrationSchema } from "../../lib/validation/registration";

const valid = {
  email: "arjun@example.com",
  password: "correct horse battery",
  confirmPassword: "correct horse battery",
  fullName: "Arjun Mehta",
  pan: "ABCDE1234F",
  phone: "9876543210",
  inviteCode: "Zm9vYmFyLWludml0ZS1jb2Rl",
};

function parse(overrides: Partial<typeof valid> = {}) {
  return registrationSchema.safeParse({ ...valid, ...overrides });
}

describe("registrationSchema", () => {
  it("accepts a well-formed registration", () => {
    expect(parse().success).toBe(true);
  });

  describe("email", () => {
    it("canonicalises case and whitespace, so one address cannot become two accounts", () => {
      const result = parse({ email: "  Arjun@Example.COM  " });
      expect(result.success && result.data.email).toBe("arjun@example.com");
    });

    it("rejects a malformed address", () => {
      expect(parse({ email: "not-an-email" }).success).toBe(false);
    });
  });

  describe("phone", () => {
    it.each([
      ["9876543210", "+919876543210"],
      ["98765 43210", "+919876543210"],
      ["+91 98765 43210", "+919876543210"],
      ["0091-9876543210", "+919876543210"],
      ["09876543210", "+919876543210"],
      ["(98765) 43210", "+919876543210"],
    ])("normalises %s to E.164", (input, expected) => {
      const result = parse({ phone: input });
      expect(result.success && result.data.phone).toBe(expected);
    });

    it.each([
      ["5876543210", "starts with 5 — not a TRAI mobile range"],
      ["98765432", "too short"],
      ["98765432100", "too long"],
      ["abcdefghij", "not digits"],
    ])("rejects %s (%s)", (input) => {
      expect(parse({ phone: input }).success).toBe(false);
    });
  });

  describe("pan", () => {
    it("uppercases, so the blind index sees a canonical value", () => {
      const result = parse({ pan: " abcde1234f " });
      expect(result.success && result.data.pan).toBe("ABCDE1234F");
    });

    it.each(["ABCD1234F", "ABCDE12345", "ABCDE1234", "ABCDE1234FG", ""])("rejects %s", (pan) => {
      expect(parse({ pan }).success).toBe(false);
    });
  });

  describe("inviteCode", () => {
    it("is required — registration is closed", () => {
      expect(parse({ inviteCode: "" }).success).toBe(false);
      expect(registrationSchema.safeParse({ ...valid, inviteCode: undefined }).success).toBe(false);
    });

    it("preserves case, since codes come from a case-sensitive alphabet", () => {
      // Lowercasing would collapse distinct codes and shrink the keyspace.
      const result = parse({ inviteCode: "  AbCdEf  " });
      expect(result.success && result.data.inviteCode).toBe("AbCdEf");
    });
  });

  describe("password", () => {
    it("requires at least 12 characters", () => {
      expect(parse({ password: "short1!", confirmPassword: "short1!" }).success).toBe(false);
    });

    it("accepts a long passphrase with no symbols or digits", () => {
      // Deliberate: composition rules are not enforced, so this must pass.
      const pw = "the quick brown fox jumps";
      expect(parse({ password: pw, confirmPassword: pw }).success).toBe(true);
    });

    it("rejects an unbounded password, which would make scrypt do unbounded work", () => {
      const pw = "a".repeat(5000);
      expect(parse({ password: pw, confirmPassword: pw }).success).toBe(false);
    });

    it("rejects mismatched confirmation, reported against the confirm field", () => {
      const result = parse({ confirmPassword: "something else entirely" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("confirmPassword"))).toBe(true);
      }
    });
  });
});

describe("loginSchema", () => {
  it("canonicalises the email the same way registration does, so login matches the stored row", () => {
    const result = loginSchema.safeParse({ email: "  Arjun@Example.COM ", password: "x" });
    expect(result.success && result.data.email).toBe("arjun@example.com");
  });

  it("does NOT apply the registration password rules", () => {
    // Enforcing them here would lock out anyone whose password predates a
    // rule change, and would leak which candidates are worth trying.
    expect(loginSchema.safeParse({ email: "a@b.com", password: "short" }).success).toBe(true);
  });

  it("still requires a non-empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});
