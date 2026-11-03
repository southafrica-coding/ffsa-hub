// Small building blocks for the Bookings screens. Reuses the kit
// (src/components), the shell rows and finance's Chips/Tag/Row where they
// fit; only what Bookings needs on top lives here.

import { Ban, Building2, Car, CircleCheck, CircleX, Clock, Flag, Square, SquareCheck, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components";
import { Chips, Row } from "@/features/finance/components/ui";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { dateRangeLabel, statusInfo, type AnyStatus, type BookingItem, type StatusIcon } from "../logic";
import { strings } from "../strings";

const ICONS: Record<StatusIcon, LucideIcon> = { clock: Clock, check: CircleCheck, x: CircleX, ban: Ban, flag: Flag };

/** Status as an icon AND words: never colour alone. */
export function StatusLine({ status }: { status: AnyStatus }) {
  const { colors } = useTheme();
  const info = statusInfo(status);
  const Icon = ICONS[info.icon];
  const color = { attention: colors.attention, positive: colors.positiveText, danger: colors.danger, secondary: colors.textSecondary }[info.tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessible accessibilityLabel={info.label} testID={`status-${status}`}>
      <Icon size={16} color={color} />
      <Text variant="label" tone={info.tone === "secondary" ? "secondary" : info.tone}>
        {info.label}
      </Text>
    </View>
  );
}

/** One booking in a list: what, where, when, status. */
export function BookingRow({ item, onPress }: { item: BookingItem; onPress: () => void }) {
  const { colors } = useTheme();
  const Icon = item.kind === "space" ? Building2 : Car;
  const dates = dateRangeLabel(item.start, item.end === item.start ? null : item.end);
  const kind = item.kind === "space" ? strings.row.space : strings.row.vehicle;
  return (
    <Row
      onPress={onPress}
      accessibilityLabel={strings.row.a11y(kind, item.title, item.place, dates, item.when, statusInfo(item.status).label)}
      testID={`booking-${item.kind}-${item.id}`}
    >
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <Icon size={18} color={colors.textSecondary} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="bodyStrong">{item.title}</Text>
          <Text tone="secondary">{item.place}</Text>
          <Text variant="caption" tone="secondary">
            {dates} · {item.when}
            {item.repeats ? ` · ${strings.row.repeats}` : ""}
          </Text>
          <StatusLine status={item.status} />
        </View>
      </View>
    </Row>
  );
}

/** A label above a value, for detail screens. Read as one unit. */
export function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ gap: 2, paddingVertical: 8 }}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  );
}

/** A checkbox row, 48dp+, the whole row toggles. */
export function CheckRow({ label, checked, onChange, hint, testID }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testID?: string }) {
  const { colors } = useTheme();
  const Icon = checked ? SquareCheck : Square;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        minHeight: touch.minTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      <Icon size={22} color={colors.text} />
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {hint ? (
          <Text variant="caption" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A required yes/no question; null means unanswered. */
export function YesNo({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Chips
        label={label}
        options={[
          { value: "yes", label: strings.inspection.yes },
          { value: "no", label: strings.inspection.no },
        ]}
        value={value === null ? null : value ? "yes" : "no"}
        onChange={(v) => onChange(v === "yes")}
      />
      {hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A bordered box for a group of related inputs (the web's bone panels). */
export function Panel({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ borderWidth: hairline, borderColor: colors.rule, backgroundColor: colors.surface, padding: 12, gap: 8 }}>
      {children}
    </View>
  );
}

/** Inline error under a form, announced when it appears. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="assertive" testID="form-error">
      {message}
    </Text>
  );
}
