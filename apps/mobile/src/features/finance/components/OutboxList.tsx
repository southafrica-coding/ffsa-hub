import { useSyncExternalStore } from "react";
import { Alert, Image, View } from "react-native";

import { Button, Text } from "@/components";
import { OutboxItemStatus, OutboxSummary, StoreProblemNotice } from "@/lib/outbox/OutboxStatus";
import { itemState, stateLabel, statusSentence } from "@/lib/outbox/status";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { formatMoney } from "../money";
import { useOutboxOnline } from "../outbox/provider";
import type { Outbox } from "../outbox/runner";
import type { OutboxItem } from "../outbox/state";
import { strings } from "../strings";

/** The item's state in words (shared outbox wording). */
export function statusText(i: OutboxItem, online = true): string {
  return stateLabel(itemState(i, online));
}

function describe(i: OutboxItem): string {
  if (i.kind === "expense") {
    return `${i.payload.description} · ${formatMoney(i.payload.zar_amount, "ZAR")} · ${i.payload.expense_date}`;
  }
  return i.fileName;
}

/**
 * What's saved on this phone but not yet on FFSA Hub. Every item says its
 * state in words (Waiting for signal · Waiting to try again · Sending ·
 * Needs you), why and what to do next, and when it was last tried; Retry
 * and Remove are offered except mid-send, and Remove asks first, because
 * removing is the only way anything here is ever lost.
 */
export function OutboxList({ items, outbox }: { items: OutboxItem[]; outbox: Outbox }) {
  const { colors } = useTheme();
  const online = useOutboxOnline();
  const problem = useSyncExternalStore(outbox.subscribe, outbox.getProblem, outbox.getProblem);
  if (items.length === 0 && !problem) return null;
  const now = Date.now();

  function confirmDiscard(i: OutboxItem) {
    Alert.alert(strings.outbox.discardConfirmTitle, strings.outbox.discardConfirmBody, [
      { text: strings.expense.cancel, style: "cancel" },
      { text: strings.outbox.discard, style: "destructive", onPress: () => void outbox.discard(i.id) },
    ]);
  }

  return (
    <View style={{ gap: 8 }}>
      <StoreProblemNotice problem={problem} onDismiss={() => outbox.dismissProblem()} />
      {items.length > 0 ? (
        <View style={{ borderWidth: hairline, borderColor: colors.attentionBorder }} testID="outbox-list">
          <View style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface, gap: 2 }}>
            <Text variant="label">{strings.outbox.savedNotSent}</Text>
            <OutboxSummary items={items} />
          </View>
          {items.map((i) => (
            <View
              key={i.id}
              style={{ padding: 12, gap: 8, borderTopWidth: hairline, borderTopColor: colors.rule }}
              testID={`outbox-item-${i.id}`}
            >
              <View
                accessible
                accessibilityLabel={`${i.kind === "expense" ? strings.outbox.pendingExpense : "Receipt photo"}: ${describe(i)}. ${statusSentence(i, online, now)}`}
                style={{ flexDirection: "row", gap: 12, alignItems: "center" }}
              >
                {i.kind === "receipt" ? (
                  <Image source={{ uri: i.localUri }} style={{ width: 48, height: 48, backgroundColor: colors.surface }} accessibilityIgnoresInvertColors />
                ) : null}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {i.kind === "expense" ? strings.outbox.pendingExpense : describe(i)}
                  </Text>
                  {i.kind === "expense" ? <Text variant="caption">{describe(i)}</Text> : null}
                  <OutboxItemStatus item={i} online={online} now={now} />
                </View>
              </View>
              {i.status === "sending" ? null : (
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    label={strings.outbox.retry}
                    accessibilityLabel={`${strings.outbox.retry}: ${describe(i)}`}
                    variant="secondary"
                    accessibilityHint={strings.outbox.retryHint}
                    onPress={() => void outbox.retry(i.id)}
                  />
                  <Button
                    label={strings.outbox.discard}
                    accessibilityLabel={`${strings.outbox.discard}: ${describe(i)}`}
                    variant="destructive"
                    onPress={() => confirmDiscard(i)}
                  />
                </View>
              )}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
