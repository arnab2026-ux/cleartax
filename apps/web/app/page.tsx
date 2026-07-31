import { redirect } from "next/navigation";

/**
 * The root path has no content of its own — this is a single-user personal
 * app, so there's no marketing/landing page to show. Send the user straight
 * to the first wizard step, which is also where `/login` lands people after
 * a successful sign-in (it pushes to "/").
 *
 * `proxy.ts` gates this route, so an unauthenticated visitor is bounced to
 * `/login` before this redirect is ever reached.
 *
 * (This replaced a Phase 0 placeholder that listed every feature as
 * "pending" and offered no navigation at all — stale and actively
 * misleading once the wizard actually existed.)
 */
export default function Home() {
  redirect("/profile");
}
