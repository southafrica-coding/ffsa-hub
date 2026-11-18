import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";

import { hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { Button } from "./Button";
import { Text } from "./Text";

export type EmptyStateProps = {
  title: string;
  /** One calm line under the title. */
  body?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  /** Draw the card border (default). `false` inside a ListGroup. */
  card?: boolean;
  testID?: string;
};

/** Calm empty / error card: icon circle, title, one line, optional action ("Try again"). */
export function EmptyState({ title, body, icon: Icon, actionLabel, onAction, card = true, testID }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        alignItems: "center",
        gap: 6,
        paddingVertical: space.xxl,
        paddingHorizontal: space.xxl,
        ...(card ? { borderWidth: hairline, borderColor: colors.rule, borderRadius: radius.card, backgroundColor: colors.surface } : null),
      }}
    >
      {Icon ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            marginBottom: 6,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: hairline,
            borderColor: colors.rule,
            backgroundColor: colors.bg,
          }}
        >
          <Icon size={24} color={colors.text} />
        </View>
      ) : null}
      <Text variant="rowTitle" accessibilityRole="header" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {body ? (
        <Text variant="caption" tone="secondary" style={{ textAlign: "center" }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: space.sm }}>
          <Button label={actionLabel} variant="secondary" size="small" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
