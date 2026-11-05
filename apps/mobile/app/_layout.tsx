import "../global.css";

import { useFonts } from "expo-font";
import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useMemo } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider, useSession } from "@/auth/session-provider";
import { AppearanceProvider, useAppearance } from "@/features/appearance";
import { fontAssets } from "@/theme/fonts";
import { navigationTheme } from "@/theme/navigation";
import { useTheme } from "@/theme/use-theme";

// Keep the native splash up until fonts are loaded, the Appearance choice is
// applied and the stored session has been restored, so nobody sees a flash
// of the wrong screen or the wrong colour scheme.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppearanceProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </AppearanceProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { status } = useSession();
  const appearance = useAppearance();
  const { scheme, colors } = useTheme();
  const navTheme = useMemo(() => navigationTheme({ scheme, colors }), [scheme, colors]);
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  // A font failure shouldn't brick the app: fall back to system fonts.
  const ready = (fontsLoaded || Boolean(fontError)) && status !== "loading" && appearance.ready;

  // The root view sits behind every screen (keyboard, rotation, transitions):
  // match it to the scheme so dark mode never flashes white.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  const signedIn = status === "signedIn";
  return (
    <ThemeProvider value={navTheme}>
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
        {/* The volunteer door (/scan/<token>) is the one route open either way:
            the token in the link is the credential, not a Hub session. */}
        <Stack.Screen name="scan" />
      </Stack>
    </ThemeProvider>
  );
}
