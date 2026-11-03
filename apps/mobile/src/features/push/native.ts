// Thin wrappers over expo-notifications / expo-device / expo-constants (SDK
// 58 APIs), so the rest of the feature works with plain values and the tests
// can stand them in. Every call here swallows native errors: push is never
// allowed to break the app.

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AndroidImportance, IosAuthorizationStatus } from "expo-notifications";
import { Linking, Platform } from "react-native";

import { PUSH_CHANNELS } from "./categories";
import type { Permission } from "./logic";

/** The Expo project id push tokens are issued for; null until Jack sets it (README). */
export function getProjectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  const id = typeof fromConfig === "string" && fromConfig ? fromConfig : Constants.easConfig?.projectId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Push needs a project id and a real phone (simulators can't get a token). */
export function isPushSupported(): boolean {
  return getProjectId() !== null && Device.isDevice && (Platform.OS === "ios" || Platform.OS === "android");
}

function toPermission(p: Notifications.NotificationPermissionsStatus): Permission {
  if (p.granted) return "granted";
  // iOS "provisional" (quiet delivery) still lets us deliver.
  if (p.ios?.status === IosAuthorizationStatus.PROVISIONAL) return "granted";
  return p.status === "denied" ? "denied" : "undetermined";
}

export async function readPermission(): Promise<Permission> {
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch {
    return "undetermined";
  }
}

export async function requestPermission(): Promise<Permission> {
  try {
    return toPermission(await Notifications.requestPermissionsAsync());
  } catch {
    return "undetermined";
  }
}

/** The Expo push token, or null if this build/phone can't get one. */
export async function getExpoToken(projectId: string): Promise<string | null> {
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return typeof data === "string" && data ? data : null;
  } catch {
    return null;
  }
}

/** A device label for the server, without the owner's name ("iPhone 15", not "Jo's iPhone"). */
export function deviceLabel(): string | null {
  return Device.modelName ?? null;
}

let configured = false;

/**
 * Foreground behaviour and Android channels. Safe to call more than once.
 * Channels must exist before Android 13+ will show the permission prompt.
 */
export async function configureNotifications(): Promise<void> {
  if (!configured) {
    configured = true;
    try {
      Notifications.setNotificationHandler({
        // In the app: show the banner and list entry, quietly.
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    } catch {
      // No native module (tests, web): nothing arrives to handle.
    }
  }
  if (Platform.OS !== "android") return;
  for (const c of PUSH_CHANNELS) {
    try {
      await Notifications.setNotificationChannelAsync(c.id, {
        name: c.name,
        description: c.description,
        importance: AndroidImportance.DEFAULT,
      });
    } catch {
      // A missing channel only means Android files it under "Miscellaneous".
    }
  }
}

export async function setAppBadge(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // Some Android launchers have no badges.
  }
}

export async function openSystemSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Nothing more we can do; the status line already says where to look.
  }
}

export { Notifications };
