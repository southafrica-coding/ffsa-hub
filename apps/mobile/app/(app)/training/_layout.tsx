import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// The Training tab (redesign 48i). Shown only to Training staff (see
// shell/tabs.ts). Every screen draws its own kit header (LargeTitle, back
// chevron + parent name), so the stack has no native header. The check-in
// form still opens as a modal over the student's record.
export default function TrainingLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="student/[id]" />
      <Stack.Screen name="checkin/[id]" options={{ presentation: "modal" }} />
    </Stack>
  );
}
