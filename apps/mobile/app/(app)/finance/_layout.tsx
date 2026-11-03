import { Stack } from "expo-router";

import { OutboxProvider } from "@/features/finance/outbox/provider";
import { getOutbox } from "@/features/finance/outbox/live";
import { strings } from "@/features/finance/strings";
import { fontFamily } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

// Finance stack: My Finance → team → expense, plus the receipt viewer.
// The outbox (receipts and expenses saved on this phone, not yet sent)
// keeps sending while this stack is mounted.
export default function FinanceLayout() {
  const { colors } = useTheme();
  return (
    <OutboxProvider outbox={getOutbox()}>
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
    </OutboxProvider>
  );
}
