import { BellOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";

import { Banner, Button, Screen, Text } from "@/components";
import { getPrefs, savePrefs, toggleMuted, type Prefs } from "@/features/me/api";
import { meStrings } from "@/features/me/strings";
import { PushSettings, pushStrings } from "@/features/push";
import { SectionBar, SkeletonRows, StateMessage } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { switchColors } from "@/theme/styles";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

const s = meStrings.prefs;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "forbidden" }
  | { state: "ready"; prefs: Prefs };

// Per-module mute toggles: GET + PUT /api/profile/notification-preferences,
// the same setting as the "Notifications" section of the web profile.
// A switch that's ON means "I get these messages".
export default function NotificationPrefsScreen() {
  const { colors, scheme } = useTheme();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getPrefs(apiFetch, { signal: controller.signal }).then(
      (prefs) => setLoad({ state: "ready", prefs }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
        if (err instanceof ApiError && err.kind === "forbidden") return setLoad({ state: "forbidden" });
        setLoad({ state: "error", message: err instanceof ApiError ? err.message : s.error.title });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  async function toggle(key: string, receive: boolean) {
    if (load.state !== "ready") return;
    const before = load.prefs;
    const muted = toggleMuted(before.mutedModules, key, receive);
    setSaveError(null);
    setSaving(key);
    setLoad({ state: "ready", prefs: { ...before, mutedModules: muted } });
    try {
      await savePrefs(apiFetch, muted);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
      // Put the switch back where it was, and say why.
      setLoad({ state: "ready", prefs: before });
      setSaveError(s.saveError);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Screen edges={["bottom"]}>
      <PushSettings />
      <SectionBar label={pushStrings.slackSection} />
      <Text tone="secondary">{s.intro}</Text>

      {load.state === "loading" ? <SkeletonRows count={2} label={s.loading} /> : null}

      {load.state === "error" ? (
        <Banner
          tone="danger"
          title={s.error.title}
          action={
            <Button
              label={s.error.retry}
              variant="secondary"
              onPress={() => {
                setLoad({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
            />
          }
        >
          {load.message}
        </Banner>
      ) : null}

      {load.state === "forbidden" ? (
        <StateMessage testID="prefs-forbidden" title={s.forbidden.title} body={s.forbidden.body} />
      ) : null}

      {load.state === "ready" && load.prefs.modules.length === 0 ? (
        <StateMessage testID="prefs-empty" icon={BellOff} title={s.empty.title} body={s.empty.body} />
      ) : null}

      {saveError ? <Banner tone="danger">{saveError}</Banner> : null}

      {load.state === "ready" && load.prefs.modules.length > 0 ? (
        <View>
          {load.prefs.modules.map((m) => {
            const on = !load.prefs.mutedModules.includes(m.key);
            return (
              <View
                key={m.key}
                style={{
                  minHeight: touch.minTarget + 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 12,
                  borderBottomWidth: hairline,
                  borderBottomColor: colors.rule,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{m.label}</Text>
                  {m.description ? (
                    <Text variant="caption" tone="secondary">
                      {m.description}
                    </Text>
                  ) : null}
                  {/* State in words too, never colour alone. */}
                  <Text variant="label" tone="secondary">
                    {on ? s.on : s.off}
                  </Text>
                </View>
                <Switch
                  testID={`pref-${m.key}`}
                  accessibilityRole="switch"
                  accessibilityLabel={m.label}
                  accessibilityHint={m.description || undefined}
                  accessibilityState={{ checked: on, busy: saving === m.key }}
                  value={on}
                  disabled={saving !== null}
                  onValueChange={(v) => void toggle(m.key, v)}
                  {...switchColors(colors, scheme, on)}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}
