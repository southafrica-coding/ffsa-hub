import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // This codebase deliberately uses `any` for Supabase's heavy generic
    // client type (see CLAUDE.md) and carries inline disable comments that
    // reference this rule, so keep the plugin loaded but downgrade to a warning
    // rather than failing the build.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "src/types/database.ts"],
  },
];

export default eslintConfig;
