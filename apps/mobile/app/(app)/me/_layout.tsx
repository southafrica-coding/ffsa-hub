import { Stack } from "expo-router";

import { meStrings } from "@/features/me/strings";
import { fontFamily } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// Me tab: the profile screen, with edit + notification settings pushed on
// top (native back button and swipe-back).
export default function MeLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fontFamily.bodyBold, color: colors.text },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="edit" options={{ title: meStrings.edit.title }} />
      <Stack.Screen name="notifications" options={{ title: meStrings.prefs.title }} />
    </Stack>
  );
}
