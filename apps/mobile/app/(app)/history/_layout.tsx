import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// My History: a hidden route of the signed-in tabs (no tab of its own; Home
// stays the active tab), opened from the Home shortcut or a Home feed item
// linking /my-history. Read-only; one screen that draws its own header
// (LargeTitle with a back chevron to Home), the record detail is a sheet.
export default function HistoryLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
