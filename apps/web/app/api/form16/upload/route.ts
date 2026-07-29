import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { parseForm16Pdf } from "@cleartax/pdf-form16";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getEnv } from "@/lib/env";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB — generous for a Form 16 PDF, guards against abuse.

/**
 * Accepts a Form 16 PDF upload, stores it in Vercel Blob, and returns the
 * heuristic parse result from @cleartax/pdf-form16. This route is
 * deliberately thin (no DB persistence, no review/edit step) — those land in
 * later phases (Phase 4 data model, Phase 5 wizard UI). The parsed output is
 * low-trust by design (see ExtractedField in @cleartax/pdf-form16); nothing
 * here should be treated as confirmed data.
 *
 * proxy.ts already gates this route (not in its public-path allowlist), but
 * per Next.js 16's own guidance, Route Handlers should verify auth
 * themselves too rather than relying solely on proxy — defense in depth.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Form 16 upload storage is not configured yet (BLOB_READ_WRITE_TOKEN missing)." },
      { status: 503 }
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field (expected a PDF upload)." }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only application/pdf uploads are accepted." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large (max 15MB)." }, { status: 413 });
  }

  const pan = formData?.get("pan");
  const dob = formData?.get("dob");
  const overridePassword = formData?.get("password");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  const blob = await put(`form16/${fileHash}.pdf`, Buffer.from(bytes), {
    access: "public",
    contentType: "application/pdf",
    token: env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
  });

  const parseResult = await parseForm16Pdf(bytes, {
    pan: typeof pan === "string" && pan.length > 0 ? pan : undefined,
    dob: typeof dob === "string" && dob.length > 0 ? dob : undefined,
    overridePassword: typeof overridePassword === "string" && overridePassword.length > 0 ? overridePassword : undefined,
  });

  return NextResponse.json({
    fileHash,
    blobUrl: blob.url,
    parseResult,
  });
}
