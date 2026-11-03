// Whether Home shows the "My Schools" shortcut: for people with at least one
// enrolment, or who hold the web's Training module. UX only; the screens'
// reads are protected by RLS whoever opens them.
//
// The last answer is remembered per person, so the shortcut doesn't pop in
// late (or vanish) when the phone is offline.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import { useSession } from "@/auth/session-provider";
import { useMe } from "@/features/shell";

import { hasEnrolment } from "./data";
import { hasSchoolsModule, showSchoolsShortcut } from "./logic";

export const enrolledFlagKey = (userId: string) => `ffsa.schools.enrolled.v1:${userId}`;

export function useSchoolsShortcut(): boolean {
  const { session } = useSession();
  const { me } = useMe();
  const userId = session?.user?.id ?? null;
  const module = hasSchoolsModule(me);
  const [enrolled, setEnrolled] = useState<{ userId: string; value: boolean } | null>(null);

  useEffect(() => {
    // Training-module holders always see it; no need to ask.
    if (!userId || module) return;
    let alive = true;
    // A fresh answer always beats the remembered one, whichever lands first.
    let fresh = false;
    const key = enrolledFlagKey(userId);
    void AsyncStorage.getItem(key)
      .then((saved) => {
        if (alive && !fresh && saved !== null) setEnrolled({ userId, value: saved === "1" });
      })
      .catch(() => {});
    hasEnrolment(userId).then(
      (value) => {
        if (!alive) return;
        fresh = true;
        setEnrolled({ userId, value });
        void AsyncStorage.setItem(key, value ? "1" : "0").catch(() => {});
      },
      // Offline or a hiccup: keep whatever was remembered.
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [userId, module]);

  return showSchoolsShortcut(me, enrolled?.userId === userId && enrolled.value);
}
