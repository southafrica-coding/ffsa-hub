import { Stack } from "expo-router";

import { useTheme } from "@/theme/use-theme";

// Finance stack: My Finance → team → expense, plus the receipt viewer.
// Every screen draws its own header (LargeTitle, or Cancel + title on the
// Add expense form, which is a full-height push with the tab bar hidden).
// The outbox that sends saved receipts and expenses is mounted one level up,
// in app/(app)/_layout.tsx, so it runs even before Finance is opened.
export default function FinanceLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="receipt" options={{ presentation: "fullScreenModal" }} />
    </Stack>
  );
}
