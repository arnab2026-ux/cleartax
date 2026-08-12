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
 *
 * Phase 13 additionally scopes the artifact to the caller's own profile. The
 * previous comment here read "no further ownership scoping beyond the session
 * check: this is a single-tenant, single-credential app — there is no second
 * user's artifact to accidentally leak", which was true when written and
 * became false the moment accounts existed. It is recorded rather than
 * quietly deleted, because it is a good example of an assumption that was
 * documented, correct, and then silently invalidated by a change elsewhere.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  // Phase 13: scoped to the caller's own profile. This used to be a bare
  // findUnique on an id taken straight from the URL, which was defensible
  // while exactly one user could exist and is a serious hole now: an ITR JSON
  // payload contains the filer's PAN, full salary breakdown, bank account and
  // address, so an unscoped lookup let any logged-in user download any other
  // user's complete return by id alone.
  //
  // 404 rather than 403 for someone else's artifact, deliberately: telling a
  // caller "this exists but is not yours" confirms the id is real and invites
  // enumeration. From outside, not-yours and not-found look identical.
  const profile = await prisma.taxpayerProfile.findUnique({ where: { userId: session.userId } });
  const artifact = profile
    ? await prisma.itrJsonArtifact.findFirst({ where: { id, taxpayerProfileId: profile.id } })
    : null;
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
