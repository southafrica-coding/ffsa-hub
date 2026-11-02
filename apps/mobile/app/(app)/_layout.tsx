import { Stack } from "expo-router";

// Signed-in area. The 4-tab bar (School · Finance · Prayer · Me) replaces
// this stack in Phase 1.
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
