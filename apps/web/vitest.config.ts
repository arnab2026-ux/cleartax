import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only unit-test lib/ code here (e.g. the field-encryption crypto) —
    // Next.js route/page rendering is out of scope for this test runner.
    include: ["test/**/*.test.ts"],
  },
});
