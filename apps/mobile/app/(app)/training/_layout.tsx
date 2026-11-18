import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// The Training tab (redesign 48i). Shown only to Training staff (see
// shell/tabs.ts). Its screen carries its own section switcher and masthead.
export default function TrainingLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
