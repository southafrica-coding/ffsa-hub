import type { ReactNode } from "react";
import { View } from "react-native";
import { Pressable } from "./Pressable";

import type { TextTone } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { LIST_ROW_MIN_HEIGHT } from "./ListGroup";
import { Text } from "./Text";
import { Toggle } from "./Toggle";

// Rows for a ListGroup that ListRow can't be: a switch row and a radio row
// whose controls VoiceOver can reach, and a static row with a separately
// reachable action. Same metrics as ListRow (56pt+, 16/12 side padding).

/**
 * A switch row for an inset list: title, description and the state in words
 * (never colour alone). The switch carries the name, hint and state for
 * screen readers, so the text beside it isn't read twice.
 */
export function SwitchRow({
  label,
  description,
  value,
  onChange,
  stateWords,
  disabled,
  busy,
  testID,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  /** "On" / "Off", shown under the description. */
  stateWords: { on: string; off: string };
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <View
      style={{
        minHeight: LIST_ROW_MIN_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: 10,
        paddingLeft: space.lg,
        paddingRight: space.md,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text variant="rowTitle">{label}</Text>
        {description ? (
          <Text variant="caption" tone="secondary">
            {description}
          </Text>
        ) : null}
        <Text variant="label" style={{ marginTop: 2 }}>
          {value ? stateWords.on : stateWords.off}
        </Text>
      </View>
      <Toggle
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={description || undefined}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityState={{ checked: value, disabled: !!disabled, busy: !!busy }}
      />
    </View>
  );
}

/** The radio mark: a thick ring when chosen (ink in light, yellow in dark), a thin one when not. Decorative. */
export function RadioMark({ checked, testID }: { checked: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: checked ? 7 : 1.5,
        borderColor: checked ? colors.primary : colors.ruleStrong,
      }}
    />
  );
}

/**
 * One choice in a single-choice list. Put the rows inside a radiogroup (a
 * ListGroup in a View with accessibilityRole="radiogroup"). Either a title +
 * caption, or your own `children`; the mark sits after the text by default,
 * or before it (`mark="leading"`, the space picker).
 */
export function RadioRow({
  label,
  body,
  children,
  checked,
  onPress,
  mark = "trailing",
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  label?: string;
  body?: string;
  children?: ReactNode;
  checked: boolean;
  onPress: () => void;
  mark?: "leading" | "trailing";
  /** Defaults to the label. */
  accessibilityLabel?: string;
  /** Defaults to the caption. */
  accessibilityHint?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const ring = <RadioMark checked={checked} testID={checked && testID ? `${testID}-mark` : undefined} />;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint ?? body}
      accessibilityState={{ checked, selected: checked }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: LIST_ROW_MIN_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: 10,
        paddingLeft: space.lg,
        paddingRight: space.md,
        backgroundColor: pressed ? colors.surfaceStrong : "transparent",
      })}
    >
      {mark === "leading" ? ring : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {label ? <Text variant="rowTitle">{label}</Text> : null}
        {body ? (
          <Text variant="caption" tone="secondary">
            {body}
          </Text>
        ) : null}
        {children}
      </View>
      {mark === "trailing" ? ring : null}
    </Pressable>
  );
}

/**
 * A row that isn't tappable (a policy, a CV entry) for an inset list. The
 * words are read as one line, and any action beside them (Remove duplicate)
 * stays separately reachable, which a kit ListRow can't do.
 */
export function StaticRow({
  testID,
  title,
  subtitle,
  note,
  noteTone = "default",
  extra,
  accessibilityLabel,
  trailing,
}: {
  testID?: string;
  title: string;
  subtitle?: string;
  /** A status line in label weight ("Expires in 12 days"). The tone only backs the words up. */
  note?: string;
  noteTone?: TextTone;
  extra?: string;
  accessibilityLabel: string;
  trailing?: ReactNode;
}) {
  return (
    <View
      testID={testID}
      style={{
        minHeight: LIST_ROW_MIN_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: space.sm,
        paddingVertical: 10,
        paddingLeft: space.lg,
        paddingRight: space.md,
      }}
    >
      <View accessible accessibilityLabel={accessibilityLabel} style={{ flex: 1, minWidth: 160, gap: 2 }}>
        <Text variant="rowTitle">{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
        {note ? (
          <Text variant="label" tone={noteTone} style={{ marginTop: 2 }}>
            {note}
          </Text>
        ) : null}
        {extra ? (
          <Text variant="caption" tone="secondary">
            {extra}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}
