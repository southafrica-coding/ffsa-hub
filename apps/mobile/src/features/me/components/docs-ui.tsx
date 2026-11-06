// Small building blocks shared by the Me document screens: a load hook with
// the four states, a choice field (bottom sheet), a switch row, a read-only
// field and the document-file block (view / photograph / replace / remove).

import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { Camera, Check, FileText, ImageUp, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Switch, View } from "react-native";

import { Banner, Button, Screen, Text, TextField } from "@/components";
import { ServerRefusal } from "@/features/bookings/http";
import { Sheet } from "@/features/finance/components/Sheet";
import { SkeletonRows, StateMessage } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { refreshControlColors, switchColors } from "@/theme/styles";
import { hairline, radius, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { isAllowedSignedUrl, isPdfName } from "../docs-logic";
import { meStrings } from "../strings";

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
  if (load.status === "loading") return <SkeletonRows count={4} label={loadingLabel} />;
  if (load.status !== "error") return null;
  if (isForbidden(load.error)) {
    return <StateMessage testID="forbidden" title={d.forbidden.title} body={d.forbidden.body} />;
  }
  return (
    <Banner tone="danger" title={errorTitle} action={<Button label={d.retry} variant="secondary" onPress={load.retry} />}>
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
      <Text variant="label" tone="secondary" accessibilityElementsHidden importantForAccessibility="no">
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
          justifyContent: "center",
          paddingHorizontal: 12,
          borderWidth: error ? 2 : hairline,
          borderColor: error ? colors.danger : colors.ruleStrong,
          borderRadius: radius.default,
          backgroundColor: pressed ? colors.surface : colors.bg,
        })}
      >
        <Text tone={value ? "default" : "secondary"}>{shown}</Text>
      </Pressable>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Sheet visible={open} title={d.choose(label)} onClose={() => setOpen(false)}>
        {searchable ? (
          <View style={{ paddingBottom: 8 }}>
            <TextField label={label} value={filter} onChangeText={setFilter} autoCorrect={false} autoCapitalize="none" />
          </View>
        ) : null}
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
                gap: 10,
                borderBottomWidth: hairline,
                borderBottomColor: colors.rule,
                backgroundColor: pressed ? colors.surface : "transparent",
              })}
            >
              <Text variant={on ? "bodyStrong" : "body"} style={{ flex: 1 }}>
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
      </Sheet>
    </View>
  );
}

/** A labelled on/off row (48dp+). */
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
  const { colors, scheme } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: touch.minTarget }}>
      <View style={{ flex: 1, gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text variant="bodyStrong">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ checked: value, disabled: !!disabled }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        {...switchColors(colors, scheme, value)}
      />
    </View>
  );
}

/** A read-only label + value, read as one line. */
export function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ gap: 2 }}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  );
}

/** A pushed Me screen: header from the stack, keyboard-aware, pull-to-refresh. */
export function DocScreen({
  children,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Screen scroll={false} keyboard edges={["bottom"]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} />}
      >
        {children}
      </ScrollView>
    </Screen>
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

export function FileBlock({
  label,
  hasFile,
  fileName,
  meta,
  busy,
  error,
  onView,
  onTake,
  onChoose,
  onRemove,
}: {
  label: string;
  hasFile: boolean;
  fileName: string | null;
  meta?: string;
  busy: "upload" | "remove" | null;
  error: string | null;
  onView: () => void;
  onTake: () => void;
  onChoose: () => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const f = d.file;
  const status = hasFile ? f.onFile : f.none;
  return (
    <View style={{ gap: 12 }} testID="file-block">
      <View
        accessible
        accessibilityLabel={`${label}: ${status}${meta ? `. ${meta}` : ""}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 12,
          borderWidth: hairline,
          borderColor: colors.ruleStrong,
          backgroundColor: colors.surface,
        }}
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <FileText size={22} color={colors.text} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" tone="secondary">
            {label}
          </Text>
          <Text variant="bodyStrong">{status}</Text>
          {meta ? (
            <Text variant="caption" tone="secondary">
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
      {hasFile && isPdfName(fileName) ? <Text tone="secondary">{f.pdfOnFile}</Text> : null}
      {hasFile ? <Button label={f.view} variant="secondary" onPress={onView} accessibilityHint={f.viewHint} /> : null}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button
          label={hasFile ? `${f.replace}: ${f.takePhoto.toLowerCase()}` : f.takePhoto}
          icon={<Camera size={18} color={colors.onInverse} />}
          onPress={onTake}
          loading={busy === "upload"}
          disabled={busy !== null}
          style={{ flexGrow: 1 }}
        />
        <Button
          label={f.choosePhoto}
          variant="secondary"
          icon={<ImageUp size={18} color={colors.text} />}
          onPress={onChoose}
          disabled={busy !== null}
          style={{ flexGrow: 1 }}
        />
      </View>
      {hasFile ? (
        <Button
          label={f.remove}
          variant="ghost"
          icon={<Trash2 size={18} color={colors.danger} />}
          onPress={onRemove}
          loading={busy === "remove"}
          disabled={busy !== null}
        />
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
