import { Stack } from "expo-router";

import { strings } from "@/features/finance/strings";
import { fontFamily } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// Finance stack: My Finance → team → expense, plus the receipt viewer.
// The outbox that sends saved receipts and expenses is mounted one level up,
// in app/(app)/_layout.tsx, so it runs even before Finance is opened.
export default function FinanceLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: "",
        headerBackTitle: strings.common.back,
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerBackTitleStyle: { fontFamily: fontFamily.bodyMedium },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[teamId]/new" options={{ presentation: "modal", headerTitle: "" }} />
      <Stack.Screen name="receipt" options={{ presentation: "fullScreenModal", headerShown: false }} />
    </Stack>
  );
}
