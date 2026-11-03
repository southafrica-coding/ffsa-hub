import type { ConfigContext, ExpoConfig } from "expo/config";

// Bundle ID / package name are Jack's decision (they can never change once an
// app is in the stores). Until then they come from env with an obviously-fake
// default so nobody ships the placeholder by accident.
const PLACEHOLDER_ID = "com.replace_me.ffsahub";
const iosBundleId = process.env.APP_BUNDLE_ID || PLACEHOLDER_ID;
const androidPackage = process.env.APP_ANDROID_PACKAGE || PLACEHOLDER_ID;

// Brand yellow: app icon background, Android adaptive background and splash.
const BRAND_YELLOW = "#FFB801";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "FFSA Hub",
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
    [
      "expo-splash-screen",
      {
        backgroundColor: BRAND_YELLOW,
        image: "./assets/splash-icon.png",
        imageWidth: 300,
        resizeMode: "contain",
      },
    ],
    // Door check-in scans ticket QR codes. Camera only: no microphone (no
    // video is recorded), so no RECORD_AUDIO on Android.
    [
      "expo-camera",
      {
        cameraPermission: "FFSA Hub uses the camera to scan ticket QR codes at event check-in.",
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    // Opens the signed waiver PDF in an in-app browser.
    "expo-web-browser",
    // expo-brightness is used without its config plugin on purpose: the
    // plugin only adds Android WRITE_SETTINGS (system-wide brightness), and
    // the ticket screen only brightens its own window.
    // expo-notifications (with ./assets/notification-icon.png, color
    // BRAND_YELLOW) is added when push notifications are set up.
  ],
  extra: {
    ...config.extra,
    // TODO(Jack): `eas init` adds eas.projectId here once the Expo
    // account/org exists. Deliberately absent until then.
  },
});
