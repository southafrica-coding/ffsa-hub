import { Stack, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Pressable } from "react-native";

import { Text } from "@/components";
import { getBookingsOutbox } from "@/features/bookings/outbox/live";
import { BookingsOutboxProvider } from "@/features/bookings/outbox/provider";
import { strings } from "@/features/bookings/strings";
import { fontFamily, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

/** Bookings is reached from Home (it isn't a tab), so its first screen goes back to Home. */
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
      <ChevronLeft size={24} color={colors.text} />
      <Text variant="bodyStrong">{strings.common.home}</Text>
    </Pressable>
  );
}

// Bookings: a hidden route of the signed-in tabs (no tab of its own),
// opened from the Home shortcut or a Home feed item. The vehicle-check
// outbox is mounted here because this slice owns only this folder.
export default function BookingsLayout() {
  const { colors } = useTheme();
  return (
    <BookingsOutboxProvider outbox={getBookingsOutbox()}>
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
    </BookingsOutboxProvider>
  );
}
