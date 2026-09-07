import { defineConfig } from "vitest/config";
import path from "node:path";

// The repo had no vitest config, so only test files that avoided the "@/"
// alias could run. Teaching vitest the same alias tsconfig already uses lets
// tests import app modules the normal way.
export default defineConfig({
  // tsconfig sets jsx: "preserve" for Next, which the test transformer can't
  // parse. Overriding it here fixes the pre-existing date-input.test.ts
  // parse failure.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
