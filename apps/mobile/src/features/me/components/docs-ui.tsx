// Small building blocks shared by the Me document screens: a load hook with
// the four states, a choice field (bottom sheet), a switch row and a
// read-only field. The document photo itself is DocFile (kit PhotoSlot).

import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { Check, ChevronDown, CircleAlert } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, View } from "react-native";

import { Banner, EmptyState, Sheet, Text, TextField, Toggle } from "@/components";
import { ServerRefusal } from "@/features/bookings/http";
import { ApiError } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { fontFamily, hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { isAllowedSignedUrl } from "../docs-logic";
import { meStrings } from "../strings";

import { Group, GroupSkeleton } from "./me-kit";
import { MePage } from "./MePage";

const d = meStrings.docs;

// ── Errors ─────────────────────────────────────────────────────────────────

/**
 * What to tell the person. The server's own refusal ("The next policy should
 * expire after your current one…") is specific and already plain English;
 * the shared ApiError messages are too. A raw database error from a direct
 * read is never shown (it can be technical), the fallback is.
 */
export function errorText(err: unknown, fallback: string): string {
  if (err instanceof ServerRefusal) return err.message;
  if (err instanceof ApiError && err.kind !== "http" && err.kind !== "invalid_response") return err.message;
  return fallback;
}

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "forbidden";
}

// ── Loading ────────────────────────────────────────────────────────────────

export type Load<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: unknown };

/** Load once on mount; `retry` after an error, `refresh` for pull-to-refresh (keeps data while it runs). */
export function useLoad<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<Load<T>>({ status: "loading", data: null, error: null });
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef(loader);
  useEffect(() => {
    ref.current = loader;
  });

  useEffect(() => {
    const c = new AbortController();
    ref.current(c.signal).then(
      (data) => {
        if (c.signal.aborted) return;
        setState({ status: "ready", data, error: null });
        setRefreshing(false);
      },
      (error: unknown) => {
        if (c.signal.aborted) return;
        setState({ status: "error", data: null, error });
        setRefreshing(false);
      },
    );
    return () => c.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading", data: null, error: null });
    setAttempt((n) => n + 1);
  }, []);
  const refresh = useCallback(() => {
    setRefreshing(true);
    setAttempt((n) => n + 1);
  }, []);
  const setData = useCallback((fn: (prev: T) => T) => {
    setState((s) => (s.status === "ready" ? { ...s, data: fn(s.data) } : s));
  }, []);

  return { ...state, refreshing, retry, refresh, setData };
}

/** Loading skeleton, error with retry, or "not on your account"; null when ready. */
export function LoadGate({
  load,
  loadingLabel,
  errorTitle,
}: {
  load: { status: string; error: unknown; retry: () => void };
  loadingLabel: string;
  errorTitle: string;
}) {
  if (load.status === "loading") return <GroupSkeleton count={4} label={loadingLabel} />;
  if (load.status !== "error") return null;
  if (isForbidden(load.error)) {
    return <EmptyState testID="forbidden" title={d.forbidden.title} body={d.forbidden.body} />;
  }
  return (
    <Banner tone="error" title={errorTitle} actionLabel={d.retry} onAction={load.retry}>
      {errorText(load.error, d.loadError)}
    </Banner>
  );
}

// ── Fields ─────────────────────────────────────────────────────────────────

export type Choice = { value: string; label: string };

/** A labelled field that opens a bottom sheet of choices (with a filter for long lists). */
export function OptionField({
  label,
  value,
  options,
  onChange,
  error,
  searchable = false,
  testID,
}: {
  label: string;
  value: string;
  options: Choice[];
  onChange: (v: string) => void;
  error?: string;
  searchable?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const shown = options.find((o) => o.value === value)?.label ?? (value || d.notSet);
  const q = filter.trim().toLowerCase();
  const list = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityHint={error ?? d.chooseHint}
        onPress={() => {
          setFilter("");
          setOpen(true);
        }}
        style={({ pressed }) => ({
          minHeight: touch.minTarget,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
          borderWidth: error ? 2 : hairline,
          borderColor: error ? colors.danger : colors.ruleStrong,
          borderRadius: radius.control,
          backgroundColor: pressed ? colors.surface : colors.raised,
        })}
      >
        {/* Empty: the placeholder says what to do ("Choose gender"); screen readers hear "Gender: Not set". */}
        <Text tone={value ? "default" : "quiet"} style={{ flex: 1, paddingVertical: space.sm }}>
          {value ? shown : d.choose(label)}
        </Text>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ChevronDown size={18} color={colors.textTertiary} />
        </View>
      </Pressable>
      {error ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 2 }}>
            <CircleAlert size={14} color={colors.danger} />
          </View>
          <Text variant="caption" tone="danger" accessibilityRole="alert" style={{ flex: 1, fontFamily: fontFamily.bodyMedium }}>
            {error}
          </Text>
        </View>
      ) : null}
      <Sheet visible={open} title={d.choose(label)} onClose={() => setOpen(false)}>
        {searchable ? <TextField label={label} value={filter} onChangeText={setFilter} autoCorrect={false} autoCapitalize="none" /> : null}
        <Group style={{ marginHorizontal: 0 }}>
          {list.map((o) => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityLabel={o.label}
                accessibilityState={{ selected: on, checked: on }}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={({ pressed }) => ({
                  minHeight: touch.minTarget,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  paddingVertical: space.sm,
                  paddingHorizontal: space.lg,
                  backgroundColor: pressed ? colors.surfaceStrong : "transparent",
                })}
              >
                <Text variant={on ? "rowTitle" : "body"} style={{ flex: 1 }}>
                  {o.label}
                </Text>
                {on ? (
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Check size={18} color={colors.text} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </Group>
      </Sheet>
    </View>
  );
}

/** A labelled on/off row inside a form (56pt+). The switch carries the name and hint. */
export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text variant="rowTitle">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Toggle testID={testID} accessibilityLabel={label} accessibilityHint={hint} value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  );
}

/** A read-only label + value (+ a quiet note), read as one line. */
export function ReadField({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} accessibilityHint={note} style={{ gap: 2 }}>
      <Text variant="label">{label}</Text>
      <Text>{value}</Text>
      {note ? (
        <Text variant="caption" tone="secondary">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** A pushed Me document screen: compact nav bar, keyboard-aware, pull-to-refresh. */
export function DocScreen({
  title,
  backLabel,
  tabBarHidden,
  children,
  refreshing,
  onRefresh,
}: {
  title: string;
  backLabel?: string;
  tabBarHidden?: boolean;
  children: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <MePage title={title} backLabel={backLabel} tabBarHidden={tabBarHidden} refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ gap: space.lg }}>{children}</View>
    </MePage>
  );
}

export function Intro({ children }: { children: ReactNode }) {
  return <Text tone="secondary">{children}</Text>;
}

/** Short success haptic (skipped quietly where unsupported). */
export function successTap() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Ask before a destructive step. Resolves true on the destructive choice. */
export function confirmDestructive(title: string, body: string, ok: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: d.cancel, style: "cancel", onPress: () => resolve(false) },
        { text: ok, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

// ── The document file (licence / passport photo) ───────────────────────────

/**
 * Opens a server-minted signed URL in the in-app browser. Only links to this
 * app's Supabase storage are opened; the link expires after an hour.
 */
export async function openSignedFile(url: string | null, colors: { text: string; bg: string }): Promise<boolean> {
  if (!isAllowedSignedUrl(url, getEnv().supabaseUrl)) return false;
  try {
    await WebBrowser.openBrowserAsync(url, { controlsColor: colors.text, toolbarColor: colors.bg });
    return true;
  } catch {
    return false;
  }
}
