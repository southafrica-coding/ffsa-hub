import { ChevronDown, ChevronUp, CircleAlert } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { fontFamily, fontSize, hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { Text } from "./Text";

// Form controls beyond TextField: choice chips, a select field, the field
// error line for controls that aren't text fields, and a disclosure row.
// (First built for Add expense, frames 3.4/3.8; now used across the app.)

// Chips are 36pt tall; the slop takes the target to 44 (rows are 8 apart).
const CHIP_HEIGHT = 36;
const CHIP_SLOP = { top: (touch.floor - CHIP_HEIGHT) / 2, bottom: (touch.floor - CHIP_HEIGHT) / 2 };

function chipBox(c: ReturnType<typeof useTheme>["colors"], state: { selected: boolean; pressed: boolean; disabled: boolean }) {
  return {
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    justifyContent: "center" as const,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: state.selected ? c.inverse : c.ruleStrong,
    backgroundColor: state.selected ? c.inverse : state.pressed ? c.surfaceStrong : c.raised,
    opacity: state.disabled ? 0.45 : 1,
  };
}

function ChipLabel({ children, selected }: { children: string; selected: boolean }) {
  return (
    <Text tone={selected ? "onInverse" : "default"} style={{ fontFamily: selected ? fontFamily.bodyBold : fontFamily.bodySemibold, fontSize: fontSize.note, lineHeight: 20 }}>
      {children}
    </Text>
  );
}

// ── Choice chips (a radio group): filled ink + bold = chosen ───────────────

export function ChoiceChips<T extends string>({
  label,
  labelPlacement = "above",
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  /** above: a field label over the chips. inline: first in the row. hidden: spoken on the group only. */
  labelPlacement?: "above" | "inline" | "hidden";
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  // Read on its own (iOS doesn't speak a radiogroup's label), then each radio.
  const heading =
    labelPlacement === "hidden" ? null : (
      <Text variant="label" accessibilityRole="header">
        {label}
      </Text>
    );
  return (
    <View style={{ gap: 6 }}>
      {labelPlacement === "above" ? heading : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
        {labelPlacement === "inline" ? heading : null}
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected, checked: selected, disabled }}
              disabled={disabled}
              hitSlop={CHIP_SLOP}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => chipBox(colors, { selected, pressed, disabled })}
            >
              <ChipLabel selected={selected}>{o.label}</ChipLabel>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A chip that does something once ("Today", "Yesterday"). */
export function ChipButton({ label, accessibilityHint, onPress }: { label: string; accessibilityHint?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      hitSlop={CHIP_SLOP}
      onPress={onPress}
      style={({ pressed }) => chipBox(colors, { selected: false, pressed, disabled: false })}
    >
      <ChipLabel selected={false}>{label}</ChipLabel>
    </Pressable>
  );
}

// ── Field messages ──────────────────────────────────────────────────────────

/** The kit TextField's error line, for controls that aren't text fields. */
export function FieldError({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 2 }}>
        <CircleAlert size={14} color={colors.danger} />
      </View>
      <Text variant="caption" tone="danger" accessibilityRole="alert" style={{ flex: 1, fontFamily: fontFamily.bodyMedium }}>
        {children}
      </Text>
    </View>
  );
}

// ── Select field: looks like a TextField, opens a sheet ────────────────────

export function SelectField({
  label,
  value,
  placeholder,
  error,
  disabled = false,
  accessibilityHint,
  accessibilityLabel,
  onPress,
  testID,
}: {
  label: string;
  value?: string;
  placeholder: string;
  error?: string;
  disabled?: boolean;
  accessibilityHint: string;
  /** Defaults to "label: value" (or the placeholder when empty). */
  accessibilityLabel?: string;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        testID={testID}
        accessibilityLabel={accessibilityLabel ?? `${label}: ${value ?? placeholder}`}
        accessibilityHint={error ? `${error} ${accessibilityHint}` : accessibilityHint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: touch.minTarget,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.control,
          borderWidth: error ? 2 : hairline,
          borderColor: error ? colors.danger : disabled ? colors.rule : colors.ruleStrong,
          backgroundColor: disabled || pressed ? colors.surface : colors.raised,
        })}
      >
        <Text tone={!value ? "quiet" : disabled ? "secondary" : "default"} style={{ flex: 1 }}>
          {value ?? placeholder}
        </Text>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ChevronDown size={18} color={colors.textTertiary} />
        </View>
      </Pressable>
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

// ── Disclosure row ("More details") ────────────────────────────────────────

export function Disclosure({ label, expanded, accessibilityHint, onPress }: { label: string; expanded: boolean; accessibilityHint?: string; onPress: () => void }) {
  const { colors } = useTheme();
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch.floor,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
        paddingVertical: space.sm,
        borderTopWidth: hairline,
        borderBottomWidth: hairline,
        borderColor: colors.rule,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      <Text variant="rowTitle" style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon size={18} color={colors.text} />
      </View>
    </Pressable>
  );
}
