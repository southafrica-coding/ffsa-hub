import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// The volunteer door (/scan/[token]). Public: the root layout keeps this group
// outside the auth gate, so a scan link opens here signed in or signed out.
// No tab bar, and the screen draws its own "Door scanner" header with Done.
export default function ScanLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
