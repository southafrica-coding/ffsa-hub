// Small presentational pieces every outbox list shares: an item's state in
// words (never colour alone), the waiting / needs-you count, and the notice
// shown when the saved queue couldn't be read.

import { useState } from "react";
import { View } from "react-native";

import { Banner, Button, Text } from "@/components";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { StoreProblem } from "./persist";
import type { BaseItem } from "./queue";
import { itemState, lastTriedText, stateDetail, stateLabel, summaryText } from "./status";
import { outboxStrings } from "./strings";

type Props = {
  item: Pick<BaseItem, "id" | "status" | "lastError" | "attempts" | "lastTriedAt">;
  online: boolean;
  now?: number;
};

/** The clock when the list was drawn (for "Last tried 14:05"), read once, not on every render. */
export function useNow(): number {
  const [now] = useState(Date.now);
  return now;
}

/** "NEEDS YOU" + why + what to do + "Last tried 14:05", all in words. */
export function OutboxItemStatus({ item, online, now: given }: Props) {
  const drawnAt = useNow();
  const now = given ?? drawnAt;
  const { colors } = useTheme();
  const state = itemState(item, online);
  const needsYou = state === "needs_you";
  const tried = lastTriedText(item, now);
  return (
    <View style={{ gap: 4 }} testID={`outbox-status-${item.id}`}>
      <View
        style={{
          borderWidth: needsYou ? 2 : hairline,
          borderColor: needsYou ? colors.danger : colors.attentionBorder,
          paddingHorizontal: 6,
          paddingVertical: 2,
          alignSelf: "flex-start",
        }}
      >
        <Text variant="monoLabel" tone={needsYou ? "danger" : "secondary"}>
          {stateLabel(state)}
        </Text>
      </View>
      <Text variant="caption" tone={needsYou ? "danger" : "secondary"}>
        {stateDetail(item, online)}
      </Text>
      {tried ? (
        <Text variant="caption" tone="tertiary">
          {tried}
        </Text>
      ) : null}
    </View>
  );
}

/** "3 waiting · 1 needs you" (nothing when the list is empty). */
export function OutboxSummary({ items, testID = "outbox-summary" }: { items: Pick<BaseItem, "status">[]; testID?: string }) {
  const text = summaryText(items);
  if (!text) return null;
  return (
    <Text variant="monoLabel" tone="secondary" testID={testID} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

/** Shown once after a start where the saved list couldn't be (fully) read. */
export function StoreProblemNotice({ problem, onDismiss }: { problem: StoreProblem; onDismiss: () => void }) {
  if (!problem) return null;
  const s = outboxStrings.problem;
  return (
    <Banner
      tone="danger"
      title={s.title}
      testID="outbox-store-problem"
      action={<Button label={s.dismiss} variant="secondary" accessibilityHint={s.dismissHint} onPress={onDismiss} />}
    >
      {problem === "corrupt" ? s.corrupt : s.partial}
    </Banner>
  );
}
