import { Stack, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import { strings } from "@/features/schools/strings";
import { fontFamily, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

/** My Schools is reached from Home (it isn't a tab), so its first screen goes back to Home. */
function HomeButton() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${strings.common.back}: ${strings.common.home}`}
      onPress={() => router.navigate("/")}
      hitSlop={8}
      style={{ minHeight: touch.minTarget, minWidth: touch.minTarget, flexDirection: "row", alignItems: "center", gap: 2 }}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ChevronLeft size={24} color={colors.text} />
      </View>
      <Text variant="bodyStrong">{strings.common.home}</Text>
    </Pressable>
  );
}

// A feed item can open an enrolment or My Attendance directly; the anchor
// puts the My Schools list underneath so Back has somewhere to go.
export const unstable_settings = { anchor: "index" };

// My Schools + My Attendance: a hidden route of the signed-in tabs (no tab of
// its own), opened from the Home shortcut or a Home feed item. Read-only.
export default function SchoolsLayout() {
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
      <Stack.Screen name="index" options={{ headerLeft: () => <HomeButton /> }} />
    </Stack>
  );
}
