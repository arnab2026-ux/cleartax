import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_USER_EMAIL: z.string().email(),
  AUTH_PASSWORD_HASH: z.string().min(1),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .optional(), // required starting Phase 4 (field-level encryption of PII)
  BLOB_READ_WRITE_TOKEN: z.string().optional(), // required starting Phase 3 (Form 16 uploads)
});

type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Lazily validates process.env on first server-side access; throws with a clear message if misconfigured. */
export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid/missing environment variables: ${parsed.error.issues
          .map((i) => i.path.join("."))
          .join(", ")}`
      );
    }
    cached = parsed.data;
  }
  return cached;
}
