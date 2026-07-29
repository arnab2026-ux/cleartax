/**
 * Prisma Client Extension implementing transparent field-level encryption
 * for `TaxpayerProfile.pan` / `.aadhaar` / `.bankAccountNumber` (see
 * lib/encryption.ts for the actual AES-256-GCM primitives, and
 * prisma/schema.prisma's TaxpayerProfile model header for why these
 * columns don't carry a `@unique` constraint).
 *
 * How it works:
 *  - The `query` component intercepts every TaxpayerProfile write
 *    (create/update/updateMany/updateManyAndReturn/upsert/createMany/
 *    createManyAndReturn) and encrypts the three fields in `args.data` (or
 *    `args.create`/`args.update` for upsert) before the query reaches
 *    Postgres. This list is exhaustive for the actions Prisma 7.9.1 defines
 *    that can carry TaxpayerProfile `data` (checked against the
 *    `PrismaAction` union in generated/prisma/internal/prismaNamespace.ts) —
 *    `delete`/`deleteMany` carry no field data, and this codebase has no
 *    `$queryRaw`/`$executeRaw` calls anywhere (grepped) that could bypass
 *    this extension.
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

/**
 * The exhaustive list of Prisma actions on `TaxpayerProfile` that can carry
 * `pan`/`aadhaar`/`bankAccountNumber` in their write payload, and therefore
 * MUST have a handler in the `query.taxpayerProfile` block below. Checked
 * against the `PrismaAction` union in
 * generated/prisma/internal/prismaNamespace.ts: every action there that
 * takes a `data`/`create`/`update` argument is listed here (`delete`/
 * `deleteMany` carry no field data and are correctly absent). Exported
 * purely so test/prismaFieldEncryption.test.ts can assert the extension
 * below doesn't silently drop coverage for one of these again — this is
 * exactly the class of bug that was found and fixed here
 * (`createManyAndReturn`/`updateManyAndReturn` were missing), and
 * `Prisma.defineExtension()`'s return value is an opaque function with no
 * introspectable shape, so a real database round trip (which this repo
 * doesn't have) would otherwise be the only way to notice a regression.
 */
export const TAXPAYER_PROFILE_WRITE_ACTIONS = [
  "create",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "createMany",
  "createManyAndReturn",
] as const;

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
      // `updateManyAndReturn` (a real, distinct query operation in this
      // Prisma version — confirmed against generated/prisma/models/
      // TaxpayerProfile.ts and the PrismaAction union in
      // generated/prisma/internal/prismaNamespace.ts, both of which list it
      // separately from `updateMany`) was previously NOT intercepted here.
      // Its `data` argument has the exact same shape as `updateMany`'s, so
      // without this handler, calling
      // `prisma.taxpayerProfile.updateManyAndReturn({ data: { pan: ... } } })`
      // would have written a PLAINTEXT pan/aadhaar/bankAccountNumber
      // straight to Postgres, bypassing encryption entirely. No caller in
      // this codebase uses it yet (checked: no Prisma-backed routes exist
      // beyond the seed script, which uses plain `create`/`createMany`), but
      // the whole point of this extension is that every future caller can
      // trust `prisma.taxpayerProfile.*` to encrypt transparently — leaving
      // a same-shaped sibling method uncovered was a real gap, not a
      // theoretical one.
      updateManyAndReturn({ args, query }) {
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
      // Same gap as updateManyAndReturn above, for the createMany family.
      createManyAndReturn({ args, query }) {
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
