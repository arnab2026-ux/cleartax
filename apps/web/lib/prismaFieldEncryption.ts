/**
 * Prisma Client Extension implementing transparent field-level encryption
 * for `TaxpayerProfile.pan` / `.aadhaar` / `.bankAccountNumber` (see
 * lib/encryption.ts for the actual AES-256-GCM primitives, and
 * prisma/schema.prisma's TaxpayerProfile model header for why these
 * columns don't carry a `@unique` constraint).
 *
 * How it works:
 *  - The `query` component intercepts every TaxpayerProfile write
 *    (create/update/updateMany/upsert/createMany) and encrypts the three
 *    fields in `args.data` (or `args.create`/`args.update` for upsert)
 *    before the query reaches Postgres.
 *  - The `result` component decrypts those same fields on the way out of
 *    ANY read (findUnique/findMany/etc.) — this is automatic for every read
 *    method, not something that needs enumerating per-method the way
 *    `query` does.
 *
 * Net effect: every route handler / script that goes through `prisma.
 * taxpayerProfile.*` (see lib/db.ts, which applies this extension) works
 * with plain-text DTOs exactly as if the columns weren't encrypted at all.
 * The database itself only ever stores ciphertext.
 *
 * Scope: intentionally does NOT touch `where` clauses — encrypted fields
 * are never queried by value (GCM's random IV makes equality lookups on
 * ciphertext meaningless anyway; this is a single-profile app with no need
 * to look up a TaxpayerProfile by PAN).
 */
import { Prisma } from "../generated/prisma/client";
import { decryptField, encryptField } from "./encryption";

const ENCRYPTED_TAXPAYER_PROFILE_FIELDS = ["pan", "aadhaar", "bankAccountNumber"] as const;

/**
 * Encrypts a single scalar-field write value. Handles both the plain-value
 * shape (`{ pan: "ABCDE1234F" }`, valid for `create` and often used for
 * `update`) and Prisma's field-update-operations wrapper shape
 * (`{ pan: { set: "ABCDE1234F" } }`, valid for `update`/`updateMany`) —
 * `String`/nullable-`String` scalars have no other update operators (no
 * increment/multiply/etc. for strings), so these two shapes are exhaustive.
 */
export function encryptScalarWriteValue(value: unknown): unknown {
  if (typeof value === "string") return encryptField(value);
  if (value === null || value === undefined) return value;
  if (typeof value === "object" && "set" in (value as Record<string, unknown>)) {
    const setValue = (value as { set: unknown }).set;
    if (typeof setValue === "string") return { set: encryptField(setValue) };
    if (setValue === null || setValue === undefined) return value;
  }
  // Unrecognized shape (shouldn't happen for a String/String? scalar) — leave untouched rather than risk mangling it.
  return value;
}

export function encryptWriteData<T extends Record<string, unknown>>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = { ...data };
  for (const field of ENCRYPTED_TAXPAYER_PROFILE_FIELDS) {
    if (field in out) {
      out[field] = encryptScalarWriteValue(out[field]);
    }
  }
  return out as T;
}

export function decryptRequired(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected an encrypted string value for a required TaxpayerProfile field but got: " + typeof value);
  }
  return decryptField(value);
}

export function decryptOptional(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Expected an encrypted string value (or null) for an optional TaxpayerProfile field but got: " + typeof value);
  }
  return decryptField(value);
}

export const fieldEncryptionExtension = Prisma.defineExtension({
  name: "taxpayer-profile-field-encryption",
  query: {
    taxpayerProfile: {
      create({ args, query }) {
        return query({ ...args, data: encryptWriteData(args.data as Record<string, unknown>) as typeof args.data });
      },
      update({ args, query }) {
        return query({ ...args, data: encryptWriteData(args.data as Record<string, unknown>) as typeof args.data });
      },
      updateMany({ args, query }) {
        return query({ ...args, data: encryptWriteData(args.data as Record<string, unknown>) as typeof args.data });
      },
      upsert({ args, query }) {
        return query({
          ...args,
          create: encryptWriteData(args.create as Record<string, unknown>) as typeof args.create,
          update: encryptWriteData(args.update as Record<string, unknown>) as typeof args.update,
        });
      },
      createMany({ args, query }) {
        const data = Array.isArray(args.data)
          ? args.data.map((item) => encryptWriteData(item as Record<string, unknown>))
          : encryptWriteData(args.data as Record<string, unknown>);
        return query({ ...args, data: data as typeof args.data });
      },
    },
  },
  result: {
    taxpayerProfile: {
      pan: {
        needs: { pan: true },
        compute(profile: { pan: unknown }) {
          return decryptRequired(profile.pan);
        },
      },
      aadhaar: {
        needs: { aadhaar: true },
        compute(profile: { aadhaar: unknown }) {
          return decryptOptional(profile.aadhaar);
        },
      },
      bankAccountNumber: {
        needs: { bankAccountNumber: true },
        compute(profile: { bankAccountNumber: unknown }) {
          return decryptOptional(profile.bankAccountNumber);
        },
      },
    },
  },
});
