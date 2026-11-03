import type { ReactNode } from "react";
import { View } from "react-native";

import { Banner, Button, Text } from "@/components";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

/**
 * Loading placeholder: static bone bars in the shape of the rows to come.
 * No shimmer, so there is no motion to respect or switch off.
 */
export function SkeletonRows({ rows = 3, label }: { rows?: number; label: string }) {
  const { colors } = useTheme();
  return (
    <View testID="skeleton" accessible accessibilityRole="progressbar" accessibilityLabel={label} style={{ gap: 0 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            gap: 14,
            paddingVertical: 14,
            borderBottomWidth: hairline,
            borderBottomColor: colors.rule,
          }}
        >
          <View style={{ width: 48, height: 52, backgroundColor: colors.surface }} />
          <View style={{ flex: 1, gap: 8, justifyContent: "center" }}>
            <View style={{ height: 14, width: "70%", backgroundColor: colors.surface }} />
            <View style={{ height: 11, width: "45%", backgroundColor: colors.surface }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <View testID="empty-state" accessible={!children} style={{ paddingVertical: 32, gap: 8 }}>
      <Text variant="title">{title}</Text>
      <Text tone="secondary">{body}</Text>
      {children}
    </View>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={title}
      testID="error-state"
      action={<Button label={strings.myTickets.retry} variant="secondary" onPress={onRetry} />}
    >
      {message}
    </Banner>
  );
}
