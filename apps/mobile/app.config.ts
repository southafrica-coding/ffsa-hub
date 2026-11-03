import type { ConfigContext, ExpoConfig } from "expo/config";

// Bundle ID / package name: Jack's pre-approved default (Decisions, 3 Nov 2026,
// docs/plan.md). Config only: nothing is registered with Apple, Google or
// Expo yet. It can never change once an app is in the stores, so confirm it
// before the first store build. APP_BUNDLE_ID / APP_ANDROID_PACKAGE still
// override it (e.g. for a separate internal build).
const DEFAULT_APP_ID = "com.ffsouthafrica.hub";
const iosBundleId = process.env.APP_BUNDLE_ID || DEFAULT_APP_ID;
const androidPackage = process.env.APP_ANDROID_PACKAGE || DEFAULT_APP_ID;

// Brand yellow: app icon background, Android adaptive background and splash.
const BRAND_YELLOW = "#FFB801";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "FFSA Hub",
  // TODO(Jack): `owner: "<expo-org>"` goes here once the FFSA Expo account/org
  // exists. Deliberately absent until then (no account has been created).
  slug: "ffsa-hub",
  scheme: "ffsahub",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  backgroundColor: BRAND_YELLOW,
  ios: {
    bundleIdentifier: iosBundleId,
    icon: "./assets/icon.png",
    supportsTablet: true,
    // Universal links. Inert until www.ffsahub.com serves a matching
    // apple-app-site-association (web PR 1) and the app handles the paths.
    associatedDomains: ["applinks:www.ffsahub.com"],
  },
  android: {
    package: androidPackage,
    adaptiveIcon: {
      foregroundImage: "./assets/android-adaptive-foreground.png",
      monochromeImage: "./assets/android-adaptive-monochrome.png",
      backgroundColor: BRAND_YELLOW,
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    // In-app browser for web pages the app doesn't have yet (no options:
    // the plugin only changes native config when given some).
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        backgroundColor: BRAND_YELLOW,
        image: "./assets/splash-icon.png",
        imageWidth: 300,
        resizeMode: "contain",
      },
    ],
    // expo-notifications (with ./assets/notification-icon.png, color
    // BRAND_YELLOW) is added when push notifications are set up.
  ],
  extra: {
    ...config.extra,
    // TODO(Jack): `eas init` adds eas.projectId here once the Expo
    // account/org exists. Deliberately absent until then.
  },
});
