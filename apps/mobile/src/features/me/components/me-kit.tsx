// Feature-local building blocks for the Me screens (redesign frames 6.1–6.22)
// that the shared kit doesn't have yet: a switch row and a radio row for
// inset lists, a quiet info card, a bullet list and the in-content label.
// Listed in the PR under "Kit follow-ups" so they can move to src/components.

import type { ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";

import { ListGroup, SectionHeader, SkeletonList, Text, Toggle, type SectionHeaderProps } from "@/components";
import type { TextTone } from "@/theme/styles";
import { hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

/**
 * Pages pad their content by the 20pt gutter; inset lists and cards sit at
 * 16pt (mockup `.list`), so they reach 4pt into the gutter on each side.
 */
export const GROUP_BLEED = space.inset - space.gutter;

/** An inset list (kit ListGroup) placed inside a gutter-padded page. */
export function Group({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  return (
    <ListGroup inset={false} testID={testID} style={{ marginHorizontal: GROUP_BLEED, ...style }}>
      {children}
    </ListGroup>
  );
}

/** Loading rows in the final list layout, placed like a Group. */
export function GroupSkeleton({ count, label }: { count?: number; label: string }) {
  return (
    <View style={{ marginHorizontal: GROUP_BLEED }}>
      <SkeletonList count={count} label={label} inset={false} />
    </View>
  );
}

/** Section title inside a gutter-padded page. */
export function Section(props: Omit<SectionHeaderProps, "inset">) {
  return <SectionHeader {...props} inset={false} />;
}

/** 13/600 sentence-case label above a block that isn't a text field (photo slot, entry group). */
export function BlockLabel({ children }: { children: string }) {
  return (
    <Text variant="label" accessibilityRole="header" style={{ paddingTop: space.sm, paddingBottom: space.sm }}>
      {children}
    </Text>
  );
}

/** A quiet bordered card for a short explanation with one action. */
export function InfoCard({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        marginHorizontal: GROUP_BLEED,
        gap: space.sm,
        padding: space.md,
        borderWidth: hairline,
        borderColor: colors.rule,
        borderRadius: radius.card,
        backgroundColor: colors.raised,
      }}
    >
      {children}
    </View>
  );
}

/** Plain bullets; each item is read as one line. */
export function BulletList({ items }: { items: readonly string[] }) {
  return (
    <View style={{ gap: space.xs }}>
      {items.map((item) => (
        <View key={item} accessible accessibilityLabel={item} style={{ flexDirection: "row", gap: space.sm }}>
          <Text style={{ fontSize: 14, lineHeight: 20 }}>•</Text>
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

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
        minHeight: 56,
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

/** One choice in a radio group drawn as an inset list. The mark is a shape, and the radio role says the state. */
export function RadioRow({
  label,
  body,
  checked,
  onPress,
  testID,
}: {
  label: string;
  body: string;
  checked: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={body}
      accessibilityState={{ checked, selected: checked }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: 10,
        paddingLeft: space.lg,
        paddingRight: space.md,
        backgroundColor: pressed ? colors.surfaceStrong : "transparent",
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="rowTitle">{label}</Text>
        <Text variant="caption" tone="secondary">
          {body}
        </Text>
      </View>
      <View
        testID={checked ? `${testID}-mark` : undefined}
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
        minHeight: 56,
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
