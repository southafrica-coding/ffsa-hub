// Whether the app offers Ministries: to the people who can open the web
// Ministry tab (admin, Leadership Team, or the leader of at least one
// ministry). Used by the Home shortcut and by the /ministries routes' gate.
// UX only: the list and detail endpoints check again whoever calls them.
//
// Admins and Leadership Team are known from /api/me. Everyone else is asked
// with GET /api/mobile/ministries/access, and the last answer is remembered
// per person (keyed by user id, so two people on one phone never share it),
// so the shortcut doesn't pop in late (or vanish) when the phone is offline.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import { useSession } from "@/auth/session-provider";
import { useMe } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";

import { getMinistriesAccess } from "./api";
import { ministriesAccess, seesAllFromMe, type MinistriesAccess } from "./logic";

export const accessFlagKey = (userId: string) => `ffsa.ministries.access.v1:${userId}`;

type Answer = { userId: string; value: boolean | null; fresh: boolean };

export function useMinistriesAccess(): MinistriesAccess {
  const { session } = useSession();
  const { me, status } = useMe();
  const userId = session?.user?.id ?? null;
  const seesAll = seesAllFromMe(me);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!userId || seesAll) return;
    let alive = true;
    const key = accessFlagKey(userId);
    void AsyncStorage.getItem(key)
      .then((saved) => {
        // A fresh answer always beats the remembered one, whichever lands first.
        if (alive && saved !== null) setAnswer((prev) => (prev?.userId === userId && prev.fresh ? prev : { userId, value: saved === "1", fresh: false }));
      })
      .catch(() => {});
    getMinistriesAccess(apiFetch).then(
      (value) => {
        if (!alive) return;
        setAnswer({ userId, value, fresh: true });
        void AsyncStorage.setItem(key, value ? "1" : "0").catch(() => {});
      },
      // Offline or a hiccup: keep whatever was remembered, else "couldn't tell".
      () => {
        if (alive) setAnswer((prev) => (prev?.userId === userId && prev.value !== null ? prev : { userId, value: null, fresh: false }));
      },
    );
    return () => {
      alive = false;
    };
  }, [userId, seesAll]);

  const mine = answer?.userId === userId ? answer : null;
  return ministriesAccess({ me, meLoading: status === "loading", probe: mine ? mine.value : undefined });
}

/** Home shows the shortcut only once the answer is yes (never in, then out). */
export function useMinistriesShortcut(): boolean {
  return useMinistriesAccess() === "allowed";
}
