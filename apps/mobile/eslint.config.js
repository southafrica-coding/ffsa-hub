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
    // Device-only bugs Jest can't see: use the kit's versions.
    // - NativeWind drops a function `style` on RN's Pressable on device.
    // - With no Android behaviour, KeyboardAvoidingView does nothing on an
    //   edge-to-edge Android phone and the keyboard covers the form.
    files: ["src/**/*.tsx", "app/**/*.tsx"],
    ignores: ["src/components/Pressable.tsx", "src/components/KeyboardAvoidingView.tsx", "**/__tests__/**"],
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
            {
              name: "react-native",
              importNames: ["KeyboardAvoidingView"],
              message:
                'Import KeyboardAvoidingView from "@/components" (with no behaviour on Android it does nothing on an edge-to-edge phone, and the keyboard covers the form).',
            },
          ],
        },
      ],
    },
  },
]);
