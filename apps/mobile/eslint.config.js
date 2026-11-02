// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Generated copy of the web's Supabase types (npm run types:sync).
    ignores: ["dist/*", ".expo/*", "src/types/database.ts"],
  },
]);
