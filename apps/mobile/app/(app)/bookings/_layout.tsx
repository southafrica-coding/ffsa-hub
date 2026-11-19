import { Stack } from "expo-router";

import { getBookingsOutbox } from "@/features/bookings/outbox/live";
import { BookingsOutboxProvider } from "@/features/bookings/outbox/provider";
import { useTheme } from "@/theme/use-theme";

// Bookings: a hidden route of the signed-in tabs (no tab of its own),
// opened from the Home shortcut or a Home feed item. Every screen draws its
// own header (LargeTitle with a back chevron, or Cancel on the request
// form); the new-request form and the vehicle checks are full-height pushes
// with the tab bar hidden (TAB_BAR_HIDDEN_ROUTES). The vehicle-check outbox
// is mounted here because this slice owns only this folder.
export default function BookingsLayout() {
  const { colors } = useTheme();
  return (
    <BookingsOutboxProvider outbox={getBookingsOutbox()}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </BookingsOutboxProvider>
  );
}
