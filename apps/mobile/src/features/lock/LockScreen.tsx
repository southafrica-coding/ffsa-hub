import { FingerprintPattern, ScanFace } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Banner, Button, Text } from "@/components";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { FfMarkTile } from "./FfMark";
import type { BiometricKind, UnlockOutcome } from "./logic";
import { lockStrings as s } from "./strings";

export type LockScreenProps = {
  /** First name (or preferred name), when /api/me has answered. */
  name: string | null;
  email: string | null;
  kind: BiometricKind;
  onUnlock: () => Promise<UnlockOutcome>;
  onSignOut: () => Promise<void>;
};

/**
 * Frame 1.6: the FF mark on a yellow tile, "FFSA Hub is locked", who is
 * signed in, Unlock, and "Sign out instead". Covers the whole app (no tab
 * bar). Asks for Face ID once as it appears; after a cancel it waits for
 * Unlock.
 */
export function LockScreen({ name, email, kind, onUnlock, onSignOut }: LockScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [problem, setProblem] = useState<"failed" | "unavailable" | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const alive = useRef(true);
  const autoPrompted = useRef(false);

  async function unlock() {
    setUnlocking(true);
    const outcome = await onUnlock();
    if (!alive.current) return;
    setUnlocking(false);
    setProblem(outcome === "failed" || outcome === "unavailable" ? outcome : null);
  }

  useEffect(() => {
    alive.current = true;
    if (!autoPrompted.current) {
      autoPrompted.current = true;
      void unlock();
    }
    return () => {
      alive.current = false;
    };
    // Once, as the screen appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    setSigningOut(true);
    await onSignOut();
    if (alive.current) setSigningOut(false);
  }

  const Icon = kind === "faceId" || kind === "faceUnlock" ? ScanFace : FingerprintPattern;
  const who = s.who(name, email);

  return (
    <View
      testID="lock-screen"
      accessibilityViewIsModal
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.gutter, paddingVertical: space.xxl }}
        bounces={false}
      >
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.xl }}>
          <FfMarkTile testID="lock-mark" />
          <View style={{ alignItems: "center", gap: space.xs }}>
            <Text variant="rowTitle" accessibilityRole="header" style={{ textAlign: "center" }}>
              {s.locked}
            </Text>
            {who ? (
              <Text variant="caption" tone="secondary" accessibilityLabel={s.whoA11y(name, email)} style={{ textAlign: "center" }}>
                {who}
              </Text>
            ) : null}
          </View>
          {problem ? (
            <View style={{ alignSelf: "stretch" }}>
              <Banner tone="error" title={s[problem].title} testID={`lock-${problem}`}>
                {s[problem].body}
              </Banner>
            </View>
          ) : null}
        </View>

        <View style={{ gap: space.sm, paddingTop: space.xxxl }}>
          <Button
            testID="lock-unlock"
            label={s.unlock}
            accessibilityLabel={s.unlockA11y(kind)}
            accessibilityHint={s.unlockHint}
            icon={<Icon size={20} color={colors.onPrimary} />}
            loading={unlocking}
            disabled={signingOut}
            onPress={() => void unlock()}
          />
          <Button
            testID="lock-sign-out"
            label={s.signOut}
            variant="text"
            accessibilityHint={s.signOutHint}
            loading={signingOut}
            disabled={unlocking}
            onPress={() => void signOut()}
          />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * While the app is in the background with the lock on: the mark alone, so
 * the app switcher's snapshot shows no content.
 */
export function PrivacyCover() {
  const { colors } = useTheme();
  return (
    <View
      testID="lock-cover"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}
    >
      <FfMarkTile />
    </View>
  );
}
