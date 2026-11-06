import { Stack, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import { strings } from "@/features/okrs/strings";
import { fontFamily, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

/** OKRs is reached from Home (it isn't a tab), so the wall goes back to Home. */
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

// A feed item can open one group's page directly; the anchor puts the wall
// underneath so Back has somewhere to go.
export const unstable_settings = { anchor: "index" };

// OKRs: a hidden route of the signed-in tabs (no tab of its own), opened
// from the Home shortcut or a Home feed item.
export default function OkrsLayout() {
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
      <Stack.Screen name="[ownerId]" options={{ headerBackTitle: strings.common.allGroups }} />
    </Stack>
  );
}
