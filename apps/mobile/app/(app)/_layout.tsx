import { Tabs } from "expo-router/js-tabs";

import { MeProvider, TabBar } from "@/features/shell";
import { useTheme } from "@/theme/use-theme";

// Signed-in area: the bottom tab bar (Home · Finance · Tickets · Me). The
// auth gate in app/_layout.tsx keeps signed-out users out of here entirely.
//
// Each tab's folder owns its own screens (route-folder contract, README):
// finance/ and tickets/ are built by their own slices. The bar matches routes
// on their first segment, so "finance" and "finance/index" both work.
export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <MeProvider>
      <Tabs
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      >
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="finance" options={{ title: "Finance" }} />
        <Tabs.Screen name="tickets" options={{ title: "Tickets" }} />
        <Tabs.Screen name="me" options={{ title: "Me" }} />
      </Tabs>
    </MeProvider>
  );
}
