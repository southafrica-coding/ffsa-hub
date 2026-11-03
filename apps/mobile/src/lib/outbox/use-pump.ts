// Keeps an outbox moving: sends on mount, when connectivity comes back, when
// the app returns to the foreground, and when the next backoff timer is
// due. Never a tight loop: waking respects each item's Retry-After and a
// minimum gap since its last try (see wakeItems), and the timer is re-armed
// only when the queue changes.

import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

export type Pumpable = {
  init(): Promise<void>;
  process(): Promise<void>;
  wake(): Promise<void>;
  nextWake(): Promise<number | null>;
};

/** "Unknown" (null) counts as online: trying costs one failed request. */
export const isOnlineState = (s: Pick<NetInfoState, "isConnected" | "isInternetReachable">) =>
  s.isConnected !== false && s.isInternetReachable !== false;

export function useOutboxPump(outbox: Pumpable, items: unknown): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    void outbox.init().then(() => outbox.process());
    let wasOnline: boolean | null = null;
    const unsubNet = NetInfo.addEventListener((s) => {
      const isOnline = isOnlineState(s);
      setOnline(isOnline);
      // Only on the way back (or the first report): NetInfo also fires for
      // changes that aren't reconnects (wifi → mobile data, signal strength).
      if (isOnline && wasOnline !== true) void outbox.wake();
      wasOnline = isOnline;
    });
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void outbox.wake();
    });
    return () => {
      unsubNet();
      appSub.remove();
    };
  }, [outbox]);

  // One timer for the earliest backoff, re-armed whenever the queue changes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    void outbox.nextWake().then((at) => {
      if (cancelled || at === null) return;
      timer = setTimeout(() => void outbox.process(), Math.max(0, at - Date.now()) + 50);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [outbox, items]);

  return online;
}
