// Bookings' own building blocks (frames 7.1–7.14): the status chip mapping,
// the booking row, label/value pairs, inline hints, checkboxes and the
// yes/no question. The general pieces (bleed, pushed page, section title,
// load states, radio rows) live in src/components.

import { Building2, Car, Check, CircleAlert, Clock, Repeat, TriangleAlert, X, type LucideIcon } from "lucide-react-native";
import { Children, type ReactNode } from "react";
import { View } from "react-native";
import { Pressable } from "@/components/Pressable";

import { ChoiceSegments, ListRow, StatusChip, Text } from "@/components";
import { useAnnounceOnIOS } from "@/lib/a11y";
import type { ChipVariant } from "@/theme/styles";
import { fontFamily, hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { dateRangeLabel, statusInfo, type AnyStatus, type BookingItem, type StatusIcon, type StatusTone } from "../logic";
import { strings } from "../strings";

// ── Status: a chip with an icon AND the word, never colour alone ────────────

const STATUS_ICON: Record<StatusIcon, LucideIcon> = { clock: Clock, check: Check, x: X, ban: X, flag: Check };
const STATUS_VARIANT: Record<StatusTone, ChipVariant> = { attention: "attention", positive: "positive", danger: "danger", secondary: "quiet" };

export function StatusLine({ status }: { status: AnyStatus }) {
  const info = statusInfo(status);
  return <StatusChip label={info.label} variant={STATUS_VARIANT[info.tone]} icon={STATUS_ICON[info.icon]} testID={`status-${status}`} />;
}

/** One booking in a list: what, where and when, then its status chip. */
export function BookingRow({ item, onPress }: { item: BookingItem; onPress: () => void }) {
  const dates = dateRangeLabel(item.start, item.end === item.start ? null : item.end);
  const kind = item.kind === "space" ? strings.row.space : strings.row.vehicle;
  return (
    <ListRow
      icon={item.kind === "space" ? Building2 : Car}
      title={item.title}
      subtitle={`${item.place} · ${dates} · ${item.when}`}
      onPress={onPress}
      accessibilityLabel={strings.row.a11y(kind, item.title, item.place, dates, item.when, statusInfo(item.status).label)}
      testID={`booking-${item.kind}-${item.id}`}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.sm }}>
        <StatusLine status={item.status} />
        {item.repeats ? <StatusChip label={strings.row.repeats} variant="quiet" icon={Repeat} /> : null}
      </View>
    </ListRow>
  );
}

// ── Label / value pairs (detail and review) ─────────────────────────────────

/**
 * A label on the left and its value on the right, read as one unit. The
 * value drops under the label when the two don't fit (long text, large type).
 */
export function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: space.lg, rowGap: 2, paddingVertical: 3 }}
    >
      <Text variant="note" style={{ fontFamily: fontFamily.body }}>
        {label}
      </Text>
      <Text variant="note" tone="default" style={{ fontFamily: fontFamily.bodyMedium, flexGrow: 1, flexShrink: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}

/** The column of Fields. */
export function FieldList({ children }: { children: ReactNode }) {
  return <View style={{ gap: 3 }}>{children}</View>;
}

// ── Inline hints and errors ─────────────────────────────────────────────────

const HINT_ICON = { ok: Check, warn: TriangleAlert, bad: CircleAlert } as const;

/** A one-line verdict with its icon ("Licence valid to 2028-03-31"): icon + words, never colour alone. */
export function HintLine({ tone, children, testID }: { tone: "ok" | "warn" | "bad"; children: string; testID?: string }) {
  const { colors } = useTheme();
  const Icon = HINT_ICON[tone];
  const color = { ok: colors.positiveText, warn: colors.attention, bad: colors.danger }[tone];
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 2 }}>
        <Icon size={14} color={color} />
      </View>
      <Text variant="caption" style={{ flex: 1, color, fontFamily: fontFamily.bodyMedium }}>
        {children}
      </Text>
    </View>
  );
}

/** Inline error under a form, announced when it appears. */
export function FormError({ message }: { message: string | null }) {
  const { colors } = useTheme();
  useAnnounceOnIOS(message);
  if (!message) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 2 }}>
        <CircleAlert size={14} color={colors.danger} />
      </View>
      <Text
        variant="caption"
        tone="danger"
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        testID="form-error"
        style={{ flex: 1, fontFamily: fontFamily.bodyMedium }}
      >
        {message}
      </Text>
    </View>
  );
}

// ── Checkboxes, switches and yes/no ─────────────────────────────────────────

/**
 * A checkbox row, 44pt+, the whole row toggles. `unavailable` only tells
 * screen readers the box can't be ticked (the caller still ignores presses).
 */
export function CheckRow({
  label,
  checked,
  onChange,
  hint,
  unavailable = false,
  testID,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  unavailable?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked, disabled: unavailable }}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        minHeight: touch.floor,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingVertical: 10,
        backgroundColor: pressed ? colors.surfaceStrong : "transparent",
      })}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 22,
          height: 22,
          marginTop: 1,
          borderRadius: radius.control,
          borderWidth: 1.5,
          borderColor: checked ? colors.primary : colors.ruleStrong,
          backgroundColor: checked ? colors.primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Check size={14} color={colors.onPrimary} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, lineHeight: 22 }}>{label}</Text>
        {hint ? (
          <Text variant="caption" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A required yes/no question: the kit's ChoiceSegments with booleans; null means unanswered. */
export function YesNo({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <ChoiceSegments
      label={label}
      hint={hint}
      options={[
        { value: "yes", label: strings.inspection.yes },
        { value: "no", label: strings.inspection.no },
      ]}
      value={value === null ? null : value ? "yes" : "no"}
      onChange={(v) => onChange(v === "yes")}
    />
  );
}

/** A bordered card for a group of related ticks; rows are split by hairlines. */
export function Panel({ title, hint, children, testID }: { title?: string; hint?: string; children: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const rows = Children.toArray(children);
  return (
    <View
      testID={testID}
      style={{ borderWidth: hairline, borderColor: colors.rule, borderRadius: radius.card, backgroundColor: colors.raised, paddingHorizontal: space.md, paddingVertical: space.xs }}
    >
      {title ? (
        <Text variant="label" tone="default" accessibilityRole="header" style={{ paddingTop: space.sm }}>
          {title}
        </Text>
      ) : null}
      {hint ? (
        <Text variant="caption" tone="secondary" style={{ paddingBottom: space.xs }}>
          {hint}
        </Text>
      ) : null}
      {rows.map((row, i) => (
        <View key={i} style={{ borderTopWidth: i > 0 ? hairline : 0, borderTopColor: colors.rule }}>
          {row}
        </View>
      ))}
    </View>
  );
}

/** A switch with its words on the left ("Runs over several days"). */
export function ToggleRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ minHeight: touch.floor, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
      {/* The switch carries the label itself. */}
      <Text style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      {children}
    </View>
  );
}
