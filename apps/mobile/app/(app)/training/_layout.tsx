import { Stack } from "expo-router";

import { fontFamily } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The Training tab (redesign 48i). Shown only to Training staff (see
// shell/tabs.ts). The tab's first screen carries its own section switcher
// and masthead; a student's record and the check-in form push on top with
// a plain back button.
export default function TrainingLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTitle: "",
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fontFamily.bodyBold, color: colors.text },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="student/[id]" />
      <Stack.Screen name="checkin/[id]" options={{ presentation: "modal" }} />
    </Stack>
  );
}
