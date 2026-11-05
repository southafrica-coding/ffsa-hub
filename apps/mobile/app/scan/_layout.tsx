import { Stack } from "expo-router";

import { strings } from "@/features/public-scan/strings";
import { fontFamily } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// The volunteer door (/scan/[token]). Public: the root layout keeps this group
// outside the auth gate, so a scan link opens here signed in or signed out.
// A plain native header (flat, no shadow), like the staff door.
export default function ScanLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fontFamily.bodyBold, color: colors.text },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="[token]" options={{ title: strings.title }} />
    </Stack>
  );
}
