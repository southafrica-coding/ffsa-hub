import { Stack } from "expo-router";

import { AppearanceScreen, appearanceStrings } from "@/features/appearance";

// Me > Appearance (Match phone / Light / Dark). The header comes from the Me
// stack; only the title is set here so app/(app)/me/_layout.tsx stays as is.
export default function AppearanceRoute() {
  return (
    <>
      <Stack.Screen options={{ title: appearanceStrings.title }} />
      <AppearanceScreen />
    </>
  );
}
