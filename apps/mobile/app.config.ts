import type { ConfigContext, ExpoConfig } from "expo/config";

// Bundle ID / package name: Jack's pre-approved default (Decisions, 3 Nov 2026,
// docs/plan.md). Config only: nothing is registered with Apple, Google or
// Expo yet. It can never change once an app is in the stores, so confirm it
// before the first store build. APP_BUNDLE_ID / APP_ANDROID_PACKAGE still
// override it (e.g. for a separate internal build).
const DEFAULT_APP_ID = "com.ffsouthafrica.hub";
const iosBundleId = process.env.APP_BUNDLE_ID || DEFAULT_APP_ID;
const androidPackage = process.env.APP_ANDROID_PACKAGE || DEFAULT_APP_ID;

// Expo project id (public, not a secret). Unset until Jack creates the Expo
// project; see README "Push notifications".
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || process.env.EAS_PROJECT_ID || undefined;

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
    // The app handles /scan/<token> (volunteer door); the AASA lists it.
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
    // App links. Only the volunteer door (/scan/<token>) for now, so a scan
    // link shared in a group chat opens the door in the app. Verified
    // against www.ffsahub.com/.well-known/assetlinks.json; until that file
    // carries the real package and signing fingerprint, Android keeps
    // opening these links in the browser (nothing breaks).
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "www.ffsahub.com", pathPrefix: "/scan/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
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
    // expo-camera and expo-image-picker both set the iOS camera prompt
    // (NSCameraUsageDescription), so they carry the same combined text.
    // Door check-in scans ticket QR codes. Camera only: no microphone (no
    // video is recorded), so no RECORD_AUDIO on Android.
    [
      "expo-camera",
      {
        cameraPermission:
          "FFSA Hub uses the camera to scan ticket QR codes at event check-in, to photograph receipts for your outreach team's expenses, and to photograph a vehicle's condition when you collect or return it.",
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    // expo-brightness is used without its config plugin on purpose: the
    // plugin only adds Android WRITE_SETTINGS (system-wide brightness), and
    // the ticket screen only brightens its own window.
    // Receipt photos (finance). The camera is asked for just in time, after an
    // in-app explanation; no microphone (stills only). The photo library uses
    // the system picker, which needs no access on iOS 14+ / Android 13+.
    [
      "expo-image-picker",
      {
        cameraPermission:
          "FFSA Hub uses the camera to scan ticket QR codes at event check-in, to photograph receipts for your outreach team's expenses, and to photograph a vehicle's condition when you collect or return it.",
        photosPermission:
          "FFSA Hub lets you choose a photo of a receipt to attach to an outreach expense, or a photo of a vehicle to attach to its collection or return check.",
        microphonePermission: false,
      },
    ],
    // Push notifications (Expo push service). Android small icon is the
    // white FF mark; the tint is brand yellow. No custom sounds and no
    // background pushes: notifications are shown by the system only.
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: BRAND_YELLOW,
      },
    ],
  ],
  extra: {
    ...config.extra,
    // TODO(Jack): the Expo project id (from `eas init`, once the Expo
    // account/org exists) goes in EXPO_PUBLIC_EAS_PROJECT_ID or
    // EAS_PROJECT_ID. Push notifications need it; without it the app says
    // "Notifications are not switched on for this build yet".
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
});
