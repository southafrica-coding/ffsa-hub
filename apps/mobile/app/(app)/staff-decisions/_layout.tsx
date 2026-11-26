import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// A feed item can open one school directly; the anchor
// puts the schools list underneath so Back has somewhere to go.
export const unstable_settings = { anchor: "index" };

// Staff decisions: a hidden route of the signed-in tabs (no tab of
// its own), opened from the Home shortcut or a Home feed item. Every screen
// draws its own header (LargeTitle with a back chevron: the list goes back
// to Home).
export default function StaffDecisionsLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
