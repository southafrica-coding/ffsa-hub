import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { signOutOfThisPhone } from "@/features/me/sign-out";
import { useMe } from "@/features/shell";

import { useLock } from "./LockProvider";
import { LockScreen, PrivacyCover } from "./LockScreen";

/**
 * Wraps the signed-in area (app/(app)/_layout.tsx). While locked the lock
 * screen covers everything, tab bar included, and screen readers can't reach
 * what's underneath. The screens stay mounted, so unlocking returns you to
 * where you were.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const { locked, covered, biometrics, unlock } = useLock();
  const { session } = useSession();
  const { me } = useMe();
  const hidden = locked || covered;

  const name = me?.profile?.preferredName || me?.profile?.firstName || null;
  const email = me?.user?.email ?? session?.user?.email ?? null;
  const kind = biometrics.status === "available" ? biometrics.kind : "faceId";

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {locked ? (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen name={name} email={email} kind={kind} onUnlock={unlock} onSignOut={signOutOfThisPhone} />
        </View>
      ) : covered ? (
        <View style={StyleSheet.absoluteFill}>
          <PrivacyCover />
        </View>
      ) : null}
    </View>
  );
}
