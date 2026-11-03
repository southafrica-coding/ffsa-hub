import Constants from "expo-constants";
import { usePathname, useRouter, type Href } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";

import { useSession } from "@/auth/session-provider";
import { openWebPage, useTabBadge } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { useTheme } from "@/theme/use-theme";

import { isPushNotEnabled, registerDevice, unregisterDevice } from "./api";
import { planSync, shouldOfferPrePrompt, targetForNotification, type Permission, type PushStatus } from "./logic";
import {
  Notifications,
  configureNotifications,
  deviceLabel,
  getExpoToken,
  getProjectId,
  isPushSupported,
  openSystemSettings,
  readPermission,
  requestPermission,
  setAppBadge,
} from "./native";
import { PrePromptSheet } from "./PrePromptSheet";
import { readPushState, setRegistration, updatePerson } from "./store";

// Push notifications for the signed-in person (mounted once, inside
// MeProvider, in app/(app)/_layout.tsx):
//  - keeps this phone's registration with the server in step with their
//    choice, the phone's permission, the token and the app version;
//  - asks for permission only after a friendly pre-prompt (never on the
//    first launches, never twice in a month after "Not now");
//  - opens the right screen when a notification is tapped (warm or cold);
//  - mirrors Home's unread count on the app icon.
// Push is optional: every failure leaves the app working as before.

export type PushContextValue = {
  status: PushStatus;
  /** The person's choice for this phone; undefined = never decided. */
  enabled: boolean | undefined;
  busy: boolean;
  /** Me's master switch. Turning on may show the pre-prompt first. */
  setEnabled: (on: boolean) => Promise<void>;
  retry: () => void;
  openSettings: () => void;
};

const PushContext = createContext<PushContextValue | null>(null);

/** null outside PushProvider (e.g. a screen rendered on its own in a test). */
export function usePush(): PushContextValue | null {
  return useContext(PushContext);
}

/** Subscribe to a native event; a missing native module (tests, web) just means no events. */
function listen(subscribe: () => { remove?: () => void } | undefined): { remove: () => void } {
  try {
    const sub = subscribe();
    return { remove: () => sub?.remove?.() };
  } catch {
    return { remove: () => {} };
  }
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

export function PushProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.status === "signedIn" ? (session.session?.user?.id ?? null) : null;
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useTheme();

  const [status, setStatus] = useState<PushStatus>("loading");
  const [enabled, setEnabledState] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<"hidden" | "fromSwitch">("hidden");
  const [offer, setOffer] = useState(false);

  const mounted = useRef(true);
  const serverNotEnabled = useRef(false);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ── Registration ─────────────────────────────────────────────────────────

  const runSync = useCallback(async () => {
    if (!userId) return;
    const supported = isPushSupported();
    const local = await readPushState();
    const choice = local.people[userId]?.enabled;
    const permission: Permission = supported ? await readPermission() : "undetermined";
    const projectId = getProjectId();
    const token =
      supported && projectId && choice === true && permission === "granted" ? await getExpoToken(projectId) : null;
    const version = appVersion();

    const plan = planSync({
      supported,
      serverNotEnabled: serverNotEnabled.current,
      enabled: choice,
      permission,
      userId,
      appVersion: version,
      token,
      registered: local.registration,
    });

    let next: PushStatus;
    if (plan.action === "register") {
      try {
        await registerDevice(apiFetch, {
          expoToken: plan.token,
          platform: Platform.OS === "ios" ? "ios" : "android",
          appVersion: version,
          deviceName: deviceLabel(),
        });
        await setRegistration({ token: plan.token, appVersion: version, userId });
        next = "on";
      } catch (err) {
        if (isPushNotEnabled(err)) {
          // Not switched on server-side: say so, and don't ask again until next launch.
          serverNotEnabled.current = true;
          next = "not_enabled";
        } else if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) {
          return; // signed out already
        } else {
          next = "error";
        }
      }
    } else if (plan.action === "unregister") {
      try {
        await unregisterDevice(apiFetch, plan.token);
        await setRegistration(null);
      } catch (err) {
        if (isPushNotEnabled(err)) await setRegistration(null);
        // Otherwise keep it, so the next sync tries again.
      }
      next = plan.status;
    } else {
      next = plan.status;
    }

    if (!mounted.current) return;
    setEnabledState(choice);
    setStatus(next);
    setOffer(
      shouldOfferPrePrompt({
        supported,
        serverNotEnabled: serverNotEnabled.current,
        enabled: choice,
        permission: supported ? permission : null,
        launches: local.people[userId]?.launches ?? 0,
        dismissedAt: local.people[userId]?.dismissedAt ?? null,
        now: Date.now(),
      }),
    );
  }, [userId]);

  /** Run a sync; if one is running, run once more after it (never in parallel). */
  const sync = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const loop = (async () => {
      do {
        again.current = false;
        try {
          await runSync();
        } catch {
          if (mounted.current) setStatus("error");
        }
      } while (again.current);
    })();
    running.current = loop;
    try {
      await loop;
    } finally {
      running.current = null;
    }
  }, [runSync]);

  // Launch: count it (pre-prompt rule), set up channels, sync.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const local = await readPushState();
      await updatePerson(userId, { launches: (local.people[userId]?.launches ?? 0) + 1 });
      await configureNotifications();
      if (!cancelled) await sync();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, sync]);

  // Back from Settings (permission may have changed) or the background.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void sync();
    });
    return () => sub.remove();
  }, [sync]);

  // The phone's push token changed: register the new one.
  useEffect(() => {
    const sub = listen(() => Notifications.addPushTokenListener(() => void sync()));
    return () => sub.remove();
  }, [sync]);

  // ── Taps ─────────────────────────────────────────────────────────────────

  const handled = useRef(new Set<string>());
  const openResponse = useCallback(
    (response: Notifications.NotificationResponse | null) => {
      if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      const target = targetForNotification(response.notification.request.content.data);
      if (target.kind === "app") router.navigate(target.path as Href);
      else if (target.kind === "web") void openWebPage(target.path, colors);
    },
    [router, colors],
  );

  useEffect(() => {
    // Cold start: the tap that opened the app. Deferred a tick so the tab
    // navigator (our children) has mounted before we navigate.
    const timer = setTimeout(() => {
      try {
        const last = Notifications.getLastNotificationResponse();
        if (last) {
          openResponse(last);
          Notifications.clearLastNotificationResponse();
        }
      } catch {
        // No native module (tests, web): nothing to open.
      }
    }, 0);
    // Warm: taps while the app is running or in the background.
    const sub = listen(() => Notifications.addNotificationResponseReceivedListener(openResponse));
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [openResponse]);

  // ── Badge: Home's unread count (same feed, no second fetch) ──────────────

  const unread = useTabBadge("home");
  useEffect(() => {
    if (status === "on") void setAppBadge(unread);
  }, [unread, status]);

  // ── Choice ───────────────────────────────────────────────────────────────

  const turnOn = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await configureNotifications();
      await requestPermission();
      await updatePerson(userId, { enabled: true });
      await sync();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [userId, sync]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (!userId) return;
      if (!on) {
        setBusy(true);
        try {
          await updatePerson(userId, { enabled: false });
          await sync();
        } finally {
          if (mounted.current) setBusy(false);
        }
        return;
      }
      // Ask the phone only after our own explanation.
      if (isPushSupported() && (await readPermission()) === "undetermined") {
        setSheet("fromSwitch");
        return;
      }
      await turnOn();
    },
    [userId, sync, turnOn],
  );

  // The sheet: asked for by Me's switch, or offered on Home once the rule says so.
  const sheetVisible = sheet === "fromSwitch" || (offer && pathname === "/");

  const accept = useCallback(async () => {
    setSheet("hidden");
    setOffer(false);
    await turnOn();
  }, [turnOn]);

  const decline = useCallback(async () => {
    setSheet("hidden");
    setOffer(false);
    if (userId) await updatePerson(userId, { dismissedAt: Date.now() });
  }, [userId]);

  const value = useMemo<PushContextValue>(
    () => ({
      status,
      enabled,
      busy,
      setEnabled,
      retry: () => {
        serverNotEnabled.current = false;
        setStatus("loading");
        void sync();
      },
      openSettings: () => void openSystemSettings(),
    }),
    [status, enabled, busy, setEnabled, sync],
  );

  return (
    <PushContext.Provider value={value}>
      {children}
      <PrePromptSheet visible={sheetVisible} onAccept={() => void accept()} onDecline={() => void decline()} />
    </PushContext.Provider>
  );
}
