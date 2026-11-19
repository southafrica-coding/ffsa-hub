import { BellOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { Banner, EmptyState, Text } from "@/components";
import { getPrefs, savePrefs, toggleMuted, type Prefs } from "@/features/me/api";
import { Group, GroupSkeleton, GROUP_BLEED, Section, SwitchRow } from "@/features/me/components/me-kit";
import { MePage } from "@/features/me/components/MePage";
import { meStrings } from "@/features/me/strings";
import { PushSettings, pushStrings } from "@/features/push";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

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
    <MePage title={s.title}>
      <PushSettings />

      <Section title={pushStrings.slackSection} />
      <View style={{ gap: 12 }}>
        <Text tone="secondary">{s.intro}</Text>

        {load.state === "loading" ? <GroupSkeleton count={2} label={s.loading} /> : null}

        {load.state === "error" ? (
          <Banner
            tone="error"
            title={s.error.title}
            actionLabel={s.error.retry}
            onAction={() => {
              setLoad({ state: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            {load.message}
          </Banner>
        ) : null}

        {load.state === "forbidden" ? (
          <View style={{ marginHorizontal: GROUP_BLEED }}>
            <EmptyState testID="prefs-forbidden" title={s.forbidden.title} body={s.forbidden.body} />
          </View>
        ) : null}

        {load.state === "ready" && load.prefs.modules.length === 0 ? (
          <View style={{ marginHorizontal: GROUP_BLEED }}>
            <EmptyState testID="prefs-empty" icon={BellOff} title={s.empty.title} body={s.empty.body} />
          </View>
        ) : null}

        {saveError ? <Banner tone="error">{saveError}</Banner> : null}

        {load.state === "ready" && load.prefs.modules.length > 0 ? (
          <Group>
            {load.prefs.modules.map((m) => (
              <SwitchRow
                key={m.key}
                testID={`pref-${m.key}`}
                label={m.label}
                description={m.description}
                value={!load.prefs.mutedModules.includes(m.key)}
                stateWords={{ on: s.on, off: s.off }}
                disabled={saving !== null}
                busy={saving === m.key}
                onChange={(v) => void toggle(m.key, v)}
              />
            ))}
          </Group>
        ) : null}
      </View>
    </MePage>
  );
}
