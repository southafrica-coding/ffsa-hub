import { Stack } from "expo-router";

import { strings } from "@/features/tickets/strings";
import { fontFamily } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// Tickets + door check-in. My tickets carries its own masthead; the screens
// below it get a plain native header with a back button (flat, no shadow).
export default function TicketsLayout() {
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
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="ticket/[id]" options={{ title: strings.ticket.title }} />
      <Stack.Screen name="check-in/index" options={{ title: strings.checkIn.listTitle }} />
      <Stack.Screen name="check-in/[eventId]" options={{ title: strings.checkIn.doorTitle }} />
    </Stack>
  );
}
