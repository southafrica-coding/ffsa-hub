import { ArrowUpRight, ChevronRight, type LucideIcon } from "lucide-react-native";
import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";

import { hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { kitStrings } from "./strings";
import { Text } from "./Text";
import { WebHint } from "./WebHint";

/**
 * Inset list: 16pt side margin (pass `inset={false}` inside a padded screen),
 * 1px rule border, 8pt radius, surface fill, hairlines between rows.
 */
export function ListGroup({
  children,
  inset = true,
  style,
  testID,
}: {
  children: ReactNode;
  inset?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const { colors } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View
      testID={testID}
      style={[
        {
          marginHorizontal: inset ? space.inset : 0,
          borderWidth: hairline,
          borderColor: colors.rule,
          borderRadius: radius.card,
          // Rows are white in light (raised), as the mockups draw them; surface (#FBFAF7) is for banners, tiles and tracks.
          backgroundColor: colors.raised,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {rows.map((row, i) => (
        <Fragment key={row.key ?? i}>
          {i > 0 ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ height: hairline, backgroundColor: colors.rule }}
            />
          ) : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export type ListRowTrailing = "chevron" | "push" | "web" | "none";

export type ListRowProps = {
  title: string;
  /** Caption under the title. */
  subtitle?: string;
  /** Shown in a 36pt tile before the text. */
  icon?: LucideIcon;
  /** Right-hand content (money, a chip, a date). */
  meta?: ReactNode;
  /** chevron (in-app push, default when tappable), web ("Opens in browser"), none. "push" = chevron. */
  trailing?: ListRowTrailing;
  /**
   * Notification rows: true = ink dot + bold title (and "Unread" for screen
   * readers); false = read, regular-weight title. Leave unset elsewhere.
   */
  unread?: boolean;
  /** Extra lines under the caption (status line, chips). */
  children?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

/** A row inside a ListGroup: 56pt+, grows with text, never truncates. */
export function ListRow({
  title,
  subtitle,
  icon: Icon,
  meta,
  trailing,
  unread,
  children,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ListRowProps) {
  const { colors } = useTheme();
  const kind: ListRowTrailing = trailing ?? (onPress ? "chevron" : "none");
  const web = kind === "web";
  const chevron = kind === "chevron" || kind === "push";
  const tappable = Boolean(onPress) && !disabled;
  const tint = disabled ? colors.textTertiary : colors.text;
  const label =
    accessibilityLabel ?? [unread ? kitStrings.unread : null, title, web ? kitStrings.opensInBrowser : null].filter(Boolean).join(". ");

  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? (web ? "link" : "button") : undefined}
      accessible
      accessibilityLabel={label}
      // The caption is part of what the row says, so it stays in the hint.
      accessibilityHint={[subtitle, accessibilityHint].filter(Boolean).join(". ") || undefined}
      accessibilityState={onPress ? { disabled } : undefined}
      disabled={!tappable}
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
      {unread ? (
        <View
          testID="list-row-unread"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: "absolute", left: 6, top: "50%", marginTop: -3, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text }}
        />
      ) : null}
      {Icon ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.card,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.bg,
            borderWidth: hairline,
            borderColor: colors.rule,
          }}
        >
          <Icon size={20} color={tint} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant={unread === false ? "body" : "rowTitle"} style={{ color: tint }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
        {web ? (
          <View style={{ marginTop: 2 }}>
            <WebHint />
          </View>
        ) : null}
        {children}
      </View>
      {meta ? <View style={{ alignItems: "flex-end", gap: 4, flexShrink: 0, maxWidth: "45%" }}>{meta}</View> : null}
      {chevron || web ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ minWidth: 18 }}>
          {web ? <ArrowUpRight size={18} color={colors.textTertiary} /> : <ChevronRight size={18} color={colors.textTertiary} />}
        </View>
      ) : null}
    </Pressable>
  );
}

/** Rows are at least 56pt; exported so tests and screens agree. */
export const LIST_ROW_MIN_HEIGHT = Math.max(56, touch.floor);
