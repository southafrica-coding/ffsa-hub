import { useCallback, useEffect, useState } from "react";
import { Switch, View } from "react-native";

import { Banner, Button, Text } from "@/components";
import { SectionBar, SkeletonRows } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

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

function SwitchRow({
  testID,
  label,
  description,
  value,
  disabled,
  busy,
  onChange,
}: {
  testID: string;
  label: string;
  description?: string;
  value: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View
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
        <Text variant="bodyStrong">{label}</Text>
        {description ? (
          <Text variant="caption" tone="secondary">
            {description}
          </Text>
        ) : null}
        <Text variant="monoLabel" tone="secondary">
          {value ? s.categories.on : s.categories.off}
        </Text>
      </View>
      <Switch
        testID={testID}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={description || undefined}
        accessibilityState={{ checked: value, disabled: !!disabled, busy: !!busy }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.ruleStrong, true: colors.text }}
        thumbColor={colors.bg}
        ios_backgroundColor={colors.ruleStrong}
      />
    </View>
  );
}

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
    <View style={{ gap: 8 }}>
      <Text variant="monoLabel" tone="secondary" accessibilityRole="header">
        {s.categories.title}
      </Text>
      {load.state === "loading" ? <SkeletonRows count={2} label={s.categories.loading} /> : null}
      {load.state === "error" ? (
        <Banner
          tone="danger"
          action={
            <Button
              label={s.categories.retry}
              variant="secondary"
              onPress={() => {
                setLoad({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
            />
          }
        >
          {s.categories.error}
        </Banner>
      ) : null}
      {saveError ? <Banner tone="danger">{s.categories.saveError}</Banner> : null}
      {load.state === "ready"
        ? load.prefs.categories.map((c) => (
            <SwitchRow
              key={c.key}
              testID={`push-cat-${c.key}`}
              label={c.label}
              description={c.description}
              value={!load.prefs.muted.includes(c.key)}
              disabled={saving !== null}
              busy={saving === c.key}
              onChange={(v) => void toggle(c.key, v)}
            />
          ))
        : null}
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
    <View testID="push-settings" style={{ gap: 12 }}>
      <SectionBar label={s.section} />

      {unavailable ? (
        <Banner testID="push-unavailable" tone="info" title={statusText(status)}>
          {status === "unsupported" ? s.status.unsupportedBody : s.status.notEnabledBody}
        </Banner>
      ) : (
        <View>
          <SwitchRow
            testID="push-master"
            label={s.master.label}
            description={s.master.hint}
            value={switchOn}
            disabled={busy || status === "loading"}
            busy={busy || status === "loading"}
            onChange={(v) => void push.setEnabled(v)}
          />
          <View
            accessible
            accessibilityLabel={`${s.status.label}: ${statusText(status)}`}
            style={{ paddingVertical: 8, gap: 2 }}
          >
            <Text variant="monoLabel" tone="secondary">
              {s.status.label}
            </Text>
            <Text testID="push-status">{statusText(status)}</Text>
          </View>
        </View>
      )}

      {status === "blocked" ? (
        <Banner
          tone="info"
          action={<Button label={s.status.openSettings} variant="secondary" onPress={push.openSettings} />}
        >
          {s.status.blockedBody}
        </Banner>
      ) : null}

      {status === "error" ? (
        <Banner
          tone="danger"
          title={s.status.error}
          action={<Button label={s.status.retry} variant="secondary" onPress={push.retry} />}
        >
          {s.status.errorBody}
        </Banner>
      ) : null}

      {status === "on" ? <CategorySwitches /> : null}
    </View>
  );
}
