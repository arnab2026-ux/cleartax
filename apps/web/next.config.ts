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
  // pdfjs-dist must NOT be bundled. It relies on Node-specific behaviour that
  // only works when loaded by the real `require` from node_modules, and
  // bundling it broke Form 16 upload in production twice, in two different
  // ways — both invisible locally, because unbundled Node and vitest resolve
  // everything normally:
  //
  //  1. `require.resolve("pdfjs-dist/package.json")`, used to locate the
  //     bundled standard-font metrics, was rewritten by Turbopack into its own
  //     resolver and returned a NUMERIC module id, so `dirname()` threw
  //     `The "path" argument must be of type string. Received type number`.
  //     Every upload 500'd.
  //  2. Once that was fixed, pdfjs's own worker bootstrap failed:
  //     `Setting up fake worker failed: Cannot find module
  //     '/var/task/apps/web/.next/server/chunks/pdf.worker.mjs'` — the worker
  //     is loaded by a dynamic import the bundler cannot trace, so the file
  //     was never emitted. Uploads returned 200 but every parse failed.
  //
  // Externalising fixes the class rather than the two instances: pdfjs is
  // loaded from node_modules at runtime, so its worker, its font data and its
  // own internal resolution all behave exactly as they do locally. The
  // defensive guard added to `standardFontDataUrl()` in decrypt.ts is kept as
  // well, so neither failure can silently return.
  serverExternalPackages: ["pdfjs-dist"],
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
