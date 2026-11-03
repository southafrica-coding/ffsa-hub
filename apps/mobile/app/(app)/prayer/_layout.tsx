import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// The Prayer tab (Phase 2 slice 2). The prayer room screen carries its own
// masthead; set details and practice bookings open as bottom sheets over it.
export default function PrayerLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
