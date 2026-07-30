import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Serves a previously-generated `ItrJsonArtifact.jsonPayload` as a
 * downloadable `.json` file — the "always-live deliverable" the Phase 6
 * brief calls for: a taxpayer clicks "Generate" on `/filing`
 * (`generateItrJson` in `actions.ts`, which validates against the real
 * government schema before ever persisting a row), then this route lets
 * them download the exact bytes to upload to the department's own e-filing
 * portal / offline utility.
 *
 * Session-checked directly (not just relying on `proxy.ts`) — matching the
 * existing pattern in `app/api/form16/upload/route.ts`, since Route
 * Handlers are directly-callable endpoints per Next.js 16's own guidance.
 * No further ownership scoping beyond the session check: this is a
 * single-tenant, single-credential app (see `PROGRESS.md`'s Phase 0 auth
 * notes) — there is no second user's artifact to accidentally leak.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const artifact = await prisma.itrJsonArtifact.findUnique({ where: { id } });
  if (!artifact) {
    return NextResponse.json({ error: "ITR JSON artifact not found." }, { status: 404 });
  }

  const filename = `${artifact.itrType}_${artifact.assessmentYear}_${artifact.id}.json`;
  return new NextResponse(JSON.stringify(artifact.jsonPayload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
