import { Tabs } from "expo-router/js-tabs";

import { getOutbox } from "@/features/finance/outbox/live";
import { OutboxProvider } from "@/features/finance/outbox/provider";
import { PushProvider } from "@/features/push";
import { MeProvider, TabBar } from "@/features/shell";
import { useTheme } from "@/theme/use-theme";

// Signed-in area: the bottom tab bar (Home · Finance · Tickets · Me). The
// auth gate in app/_layout.tsx keeps signed-out users out of here entirely.
//
// Each tab's folder owns its own screens (route-folder contract, README):
// finance/ and tickets/ are built by their own slices. The bar matches routes
// on their first segment, so "finance" and "finance/index" both work.
//
// The finance outbox (receipts and expenses saved on this phone, not yet
// sent) is mounted here, not in finance/, so it keeps sending from app start
// even if Finance is never opened. This layout only exists while signed in,
// and the outbox reads the session's user on every run, so it stays tied to
// the signed-in person exactly as before.
export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <MeProvider>
      <PushProvider>
      <OutboxProvider outbox={getOutbox()}>
        <Tabs
          tabBar={(props) => <TabBar {...props} />}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
        >
          <Tabs.Screen name="index" options={{ title: "Home" }} />
          <Tabs.Screen name="finance" options={{ title: "Finance" }} />
          <Tabs.Screen name="prayer" options={{ title: "Prayer" }} />
          <Tabs.Screen name="tickets" options={{ title: "Tickets" }} />
          <Tabs.Screen name="me" options={{ title: "Me" }} />
          <Tabs.Screen name="bookings" options={{ href: null }} />
          <Tabs.Screen name="schools" options={{ href: null }} />
          <Tabs.Screen name="history" options={{ href: null }} />
          <Tabs.Screen name="okrs" options={{ href: null }} />
          <Tabs.Screen name="ministries" options={{ href: null }} />
          <Tabs.Screen name="staff-decisions" options={{ href: null }} />
        </Tabs>
      </OutboxProvider>
      </PushProvider>
    </MeProvider>
  );
}
