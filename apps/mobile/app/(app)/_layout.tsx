import { Tabs } from "expo-router/js-tabs";

import { LockGate } from "@/features/lock";
import { getOutbox } from "@/features/finance/outbox/live";
import { OutboxProvider } from "@/features/finance/outbox/provider";
import { PushProvider } from "@/features/push";
import { MeProvider, TabBar } from "@/features/shell";
import { TrainingBadge } from "@/features/training/TrainingBadge";
import { useTheme } from "@/theme/use-theme";

// Signed-in area: the bottom tab bar (Home · Training · Finance · Prayer ·
// Tickets · Me; Training only for Training staff). The
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
//
// LockGate (Face ID lock, off unless turned on in Me › Settings) covers the
// whole area, tab bar included, while locked.
export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <MeProvider>
      <PushProvider>
      <TrainingBadge />
      <OutboxProvider outbox={getOutbox()}>
      <LockGate>
        <Tabs
          tabBar={(props) => <TabBar {...props} />}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
        >
          <Tabs.Screen name="index" options={{ title: "Home" }} />
          <Tabs.Screen name="training" options={{ title: "Training" }} />
          <Tabs.Screen name="finance" options={{ title: "Finance" }} />
          <Tabs.Screen name="prayer" options={{ title: "Prayer" }} />
          <Tabs.Screen name="tickets" options={{ title: "Tickets" }} />
          <Tabs.Screen name="me" options={{ title: "Me" }} />
          {/* Hidden routes (HOME_ROUTES in shell/tabs.ts): no button because
              TabBar draws only TABS. Never `href: null` here: SDK 58's tabs
              turn that into `hidden`, and a focused hidden tab is replaced by
              the first tab, so links, notification taps and router.push to
              these screens all landed on Home (QA, Nov 2026). */}
          <Tabs.Screen name="bookings" />
          <Tabs.Screen name="schools" />
          <Tabs.Screen name="history" />
          <Tabs.Screen name="okrs" />
          <Tabs.Screen name="ministries" />
          <Tabs.Screen name="staff-decisions" />
        </Tabs>
      </LockGate>
      </OutboxProvider>
      </PushProvider>
    </MeProvider>
  );
}
