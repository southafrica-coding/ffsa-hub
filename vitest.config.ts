import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

// Vitest doesn't read tsconfig paths, so the "@/…" alias the app uses has to
// be declared here too — without it any test whose import chain reaches an
// "@/" import fails to resolve.
export default defineConfig({
  // Next keeps "jsx": "preserve" for its compiler. Vitest's oxc transform
  // follows that and then refuses the raw JSX, so component tests opt into
  // the automatic runtime here.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "next/font/google": path.resolve(__dirname, "src/test/next-font-google.ts"),
    },
  },
  test: {
    // apps/mobile is a separate Expo app with its own Jest setup.
    // vehicles-module/ is the FFSA Fleet reference app with its own node:test suite
    // (cd vehicles-module && npm test).
    exclude: [...configDefaults.exclude, "apps/**", "vehicles-module/**"],
  },
});
