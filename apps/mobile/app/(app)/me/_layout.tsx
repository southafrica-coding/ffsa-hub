import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// Me tab: the profile screen, with its settings and document screens pushed
// on top. Every screen draws its own header (the large title on Me, a compact
// bar with the back chevron on the pushed screens), so the native header is
// off; swipe-back still works.
export default function MeLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
