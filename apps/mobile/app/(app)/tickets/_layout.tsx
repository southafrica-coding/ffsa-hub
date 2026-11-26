import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// Tickets + door check-in. Every screen draws its own LargeTitle header (back
// chevron + parent name on the pushed ones), so the native header is off.
export default function TicketsLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
