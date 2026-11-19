import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// A feed item can open an enrolment or My Attendance directly; the anchor
// puts the My Schools list underneath so Back has somewhere to go.
export const unstable_settings = { anchor: "index" };

// My Schools + My Attendance: a hidden route of the signed-in tabs (no tab of
// its own; Home stays the active tab), opened from the Home shortcut or a
// Home feed item. Read-only. Every screen draws its own header (LargeTitle
// with a back chevron: the list goes back to Home, the rest to the list).
export default function SchoolsLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
