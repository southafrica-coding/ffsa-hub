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
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // apps/mobile is a separate Expo app with its own Jest setup.
    exclude: [...configDefaults.exclude, "apps/**"],
  },
});
