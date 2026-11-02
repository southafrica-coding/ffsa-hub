import "../global.css";

import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider, useSession } from "@/auth/session-provider";
import { fontAssets } from "@/theme/fonts";
import { useTheme } from "@/theme/use-theme";

// Keep the native splash up until fonts are loaded and the stored session
// has been restored, so nobody sees a flash of the wrong screen.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { status } = useSession();
  const { scheme, colors } = useTheme();
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  // A font failure shouldn't brick the app: fall back to system fonts.
  const ready = (fontsLoaded || Boolean(fontError)) && status !== "loading";

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  const signedIn = status === "signedIn";
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        {/* Auth gate: signed-out users can only reach (auth), signed-in users only (app).
            redirectTo is explicit: without it a signed-out launch at "/" (the app's
            start URL) hits "not found" instead of sign-in. */}
        <Stack.Protected guard={signedIn} redirectTo="/sign-in">
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn} redirectTo="/">
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
