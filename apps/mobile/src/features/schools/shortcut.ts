// Whether the app offers My Schools: only to enrolled students and school
// staff (logic.ts canSeeMySchools). Used by the Home shortcut and by the
// /schools routes' gate. UX only; the screens' reads are protected by RLS
// whoever opens them.
//
// The last answer is remembered per person (keyed by user id, so two people
// on one phone never share it), so the shortcut doesn't pop in late (or
// vanish) when the phone is offline.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import { useSession } from "@/auth/session-provider";
import { useMe } from "@/features/shell";

import { loadSchoolsTies } from "./data";
import { canSeeMySchools, hasSchoolsModule, schoolsAccess, type SchoolsAccess } from "./logic";

// v2: the rule narrowed (statuses that count, assigned staff), so "1" saved
// under the old any-enrolment rule must not keep showing the shortcut.
export const enrolledFlagKey = (userId: string) => `ffsa.schools.enrolled.v2:${userId}`;
const oldFlagKey = (userId: string) => `ffsa.schools.enrolled.v1:${userId}`;

type Answer = { userId: string; value: boolean | null; fresh: boolean };

export function useSchoolsAccess(): SchoolsAccess {
  const { session } = useSession();
  const { me, status } = useMe();
  const userId = session?.user?.id ?? null;
  const module = hasSchoolsModule(me);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    // Training-module holders always see it; no need to ask.
    if (!userId || module) return;
    let alive = true;
    const key = enrolledFlagKey(userId);
    void AsyncStorage.removeItem(oldFlagKey(userId)).catch(() => {});
    void AsyncStorage.getItem(key)
      .then((saved) => {
        // A fresh answer always beats the remembered one, whichever lands first.
        if (alive && saved !== null) setAnswer((prev) => (prev?.userId === userId && prev.fresh ? prev : { userId, value: saved === "1", fresh: false }));
      })
      .catch(() => {});
    loadSchoolsTies(userId).then(
      (ties) => {
        if (!alive) return;
        const value = canSeeMySchools({ me: null, ties });
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
  }, [userId, module]);

  const mine = answer?.userId === userId ? answer : null;
  return schoolsAccess({ me, meLoading: status === "loading", tiesAnswer: mine ? mine.value : undefined });
}

/** Home shows the shortcut only once the answer is yes (never in, then out). */
export function useSchoolsShortcut(): boolean {
  return useSchoolsAccess() === "allowed";
}
