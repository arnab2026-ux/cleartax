import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  // Workspace packages (packages/*) are consumed directly from their .ts
  // source (no build step) via each one's package.json "main". Turbopack
  // doesn't apply its .js->.ts extension-remapping resolver to packages
  // outside the app's own directory tree by default (tsc's "bundler"
  // moduleResolution handles this fine, which is why `tsc --noEmit` passes
  // but `next build` failed with "Module not found: Can't resolve
  // './foo.js'" the first time a @cleartax/* package was actually imported
  // here) — transpilePackages opts these into the same resolution/transform
  // pipeline as the app's own source.
  transpilePackages: [
    "@cleartax/tax-engine",
    "@cleartax/itr-schema",
    "@cleartax/filing-provider",
    "@cleartax/pdf-form16",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
