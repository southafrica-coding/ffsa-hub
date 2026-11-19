import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { Banner, SwitchRow, Text } from "@/components";
import { Group, GroupSkeleton, Section } from "@/features/me/components/me-kit";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { getPushPrefs, isPushNotEnabled, savePushPrefs, type PushPrefs } from "./api";
import type { PushStatus } from "./logic";
import { usePush } from "./provider";
import { pushStrings } from "./strings";

const s = pushStrings;

/** The status line, always in words (never colour alone). */
export function statusText(status: PushStatus): string {
  switch (status) {
    case "loading":
      return s.status.loading;
    case "on":
      return s.status.on;
    case "blocked":
      return s.status.blocked;
    case "unsupported":
      return s.status.unsupported;
    case "not_enabled":
      return s.status.notEnabled;
    case "error":
      return s.status.error;
    default:
      return s.status.off;
  }
}

const STATE_WORDS = { on: s.categories.on, off: s.categories.off };

type Prefs = { state: "loading" } | { state: "error" } | { state: "hidden" } | { state: "ready"; prefs: PushPrefs };

/** Per-category switches, stored on the server (GET/PUT /api/devices/preferences). */
function CategorySwitches() {
  const [load, setLoad] = useState<Prefs>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getPushPrefs(apiFetch, { signal: controller.signal }).then(
      (prefs) => setLoad({ state: "ready", prefs }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
        // Not switched on server-side: the status line already says so.
        setLoad(isPushNotEnabled(err) ? { state: "hidden" } : { state: "error" });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const toggle = useCallback(
    async (key: string, receive: boolean) => {
      if (load.state !== "ready") return;
      const before = load.prefs;
      const muted = receive ? before.muted.filter((m) => m !== key) : [...before.muted.filter((m) => m !== key), key];
      setSaveError(false);
      setSaving(key);
      setLoad({ state: "ready", prefs: { ...before, muted } });
      try {
        await savePushPrefs(apiFetch, muted);
      } catch (err) {
        if (err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated")) return;
        setLoad({ state: "ready", prefs: before });
        setSaveError(true);
      } finally {
        setSaving(null);
      }
    },
    [load],
  );

  if (load.state === "hidden") return null;
  return (
    <View>
      <Section title={s.categories.title} />
      <View style={{ gap: 12 }}>
        {load.state === "loading" ? <GroupSkeleton count={2} label={s.categories.loading} /> : null}
        {load.state === "error" ? (
          <Banner
            tone="error"
            actionLabel={s.categories.retry}
            onAction={() => {
              setLoad({ state: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            {s.categories.error}
          </Banner>
        ) : null}
        {saveError ? <Banner tone="error">{s.categories.saveError}</Banner> : null}
        {load.state === "ready" && load.prefs.categories.length > 0 ? (
          <Group>
            {load.prefs.categories.map((c) => (
              <SwitchRow
                key={c.key}
                testID={`push-cat-${c.key}`}
                label={c.label}
                description={c.description}
                value={!load.prefs.muted.includes(c.key)}
                stateWords={STATE_WORDS}
                disabled={saving !== null}
                busy={saving === c.key}
                onChange={(v) => void toggle(c.key, v)}
              />
            ))}
          </Group>
        ) : null}
        {/* What a push shows on a lock screen (the pre-prompt's own wording). */}
        {load.state === "ready" ? <Text variant="note">{s.prePrompt.privacy}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Me > Notification settings: "Push notifications on this phone" master
 * switch, a status line in words, "Open Settings" when the phone blocks us,
 * and the per-category switches once push is on. Renders nothing outside
 * PushProvider.
 */
export function PushSettings() {
  const push = usePush();
  if (!push) return null;
  const { status, busy } = push;

  const unavailable = status === "unsupported" || status === "not_enabled";
  const switchOn = status === "on" || status === "blocked" || (status === "error" && push.enabled === true);

  return (
    <View testID="push-settings">
      <Section title={s.section} tight />
      <View style={{ gap: 12 }}>
        {unavailable ? (
          <Banner testID="push-unavailable" tone="info" title={statusText(status)}>
            {status === "unsupported" ? s.status.unsupportedBody : s.status.notEnabledBody}
          </Banner>
        ) : (
          <>
            <Group>
              <SwitchRow
                testID="push-master"
                label={s.master.label}
                description={s.master.hint}
                value={switchOn}
                stateWords={STATE_WORDS}
                disabled={busy || status === "loading"}
                busy={busy || status === "loading"}
                onChange={(v) => void push.setEnabled(v)}
              />
            </Group>
            <View accessible accessibilityLabel={`${s.status.label}: ${statusText(status)}`} style={{ gap: 2 }}>
              <Text variant="label">{s.status.label}</Text>
              <Text testID="push-status">{statusText(status)}</Text>
            </View>
          </>
        )}

        {status === "blocked" ? (
          <Banner tone="info" actionLabel={s.status.openSettings} onAction={push.openSettings}>
            {s.status.blockedBody}
          </Banner>
        ) : null}

        {status === "error" ? (
          <Banner tone="error" title={s.status.error} actionLabel={s.status.retry} onAction={push.retry}>
            {s.status.errorBody}
          </Banner>
        ) : null}
      </View>

      {status === "on" ? <CategorySwitches /> : null}
    </View>
  );
}
