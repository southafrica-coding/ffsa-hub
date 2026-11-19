// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Generated copy of the web's Supabase types (npm run types:sync).
    ignores: ["dist/*", ".expo/*", "src/types/database.ts"],
  },
  {
    // NativeWind drops a function `style` on RN's Pressable on device: use the kit's.
    files: ["src/**/*.tsx", "app/**/*.tsx"],
    ignores: ["src/components/Pressable.tsx", "**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-native",
              importNames: ["Pressable"],
              message: 'Import Pressable from "@/components/Pressable" (NativeWind drops function styles on RN\'s Pressable on a real device).',
            },
          ],
        },
      ],
    },
  },
]);
