import { Clock, RefreshCw, TriangleAlert } from "lucide-react-native";
import { useSyncExternalStore } from "react";
import { Alert, Image, View } from "react-native";

import { Button, Text } from "@/components";
import { StoreProblemNotice, useNow } from "@/lib/outbox/OutboxStatus";
import { itemState, lastTriedText, stateDetail, stateLabel, statusSentence, summaryText } from "@/lib/outbox/status";
import { fontFamily, hairline, radius, space } from "@/theme/tokens";
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
  const now = useNow();
  if (items.length === 0 && !problem) return null;

  function confirmDiscard(i: OutboxItem) {
    Alert.alert(strings.outbox.discardConfirmTitle, strings.outbox.discardConfirmBody, [
      { text: strings.expense.cancel, style: "cancel" },
      { text: strings.outbox.discard, style: "destructive", onPress: () => void outbox.discard(i.id) },
    ]);
  }

  return (
    <View style={{ gap: space.sm }}>
      <StoreProblemNotice problem={problem} onDismiss={() => outbox.dismissProblem()} />
      {items.length > 0 ? (
        <View
          style={{ borderWidth: hairline, borderColor: colors.attentionBorder, borderRadius: radius.card, backgroundColor: colors.raised, overflow: "hidden" }}
          testID="outbox-list"
        >
          <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.surface }}>
            <Text variant="label" tone="default" accessibilityRole="header">
              {strings.outbox.savedNotSent}
            </Text>
            <Text variant="caption" tone="secondary" testID="outbox-summary" accessibilityLiveRegion="polite">
              {summaryText(items)}
            </Text>
          </View>
          {items.map((i) => (
            <View
              key={i.id}
              style={{ paddingHorizontal: space.md, paddingVertical: 10, gap: space.sm, borderTopWidth: hairline, borderTopColor: colors.rule }}
              testID={`outbox-item-${i.id}`}
            >
              <View
                accessible
                accessibilityLabel={`${i.kind === "expense" ? strings.outbox.pendingExpense : strings.outbox.receiptPhoto}: ${describe(i)}. ${statusSentence(i, online, now)}`}
                style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}
              >
                {i.kind === "receipt" ? (
                  <Image
                    source={{ uri: i.localUri }}
                    style={{ width: 44, height: 44, borderRadius: radius.control, borderWidth: hairline, borderColor: colors.rule, backgroundColor: colors.surface }}
                    accessibilityIgnoresInvertColors
                  />
                ) : null}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text variant="rowTitle">{i.kind === "expense" ? strings.outbox.pendingExpense : describe(i)}</Text>
                  {i.kind === "expense" ? <Text variant="caption">{describe(i)}</Text> : null}
                  <ItemState item={i} online={online} now={now} />
                </View>
              </View>
              {i.status === "sending" ? null : (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button
                    label={strings.outbox.retry}
                    accessibilityLabel={`${strings.outbox.retry}: ${describe(i)}`}
                    accessibilityHint={strings.outbox.retryHint}
                    variant="secondary"
                    size="small"
                    style={{ flex: 1 }}
                    onPress={() => void outbox.retry(i.id)}
                  />
                  <Button
                    label={strings.outbox.discard}
                    accessibilityLabel={`${strings.outbox.discard}: ${describe(i)}`}
                    variant="danger"
                    size="small"
                    style={{ flex: 1 }}
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

/**
 * The item's state as an icon and a bold word, then what happens next and
 * when it was last tried (the shared outbox wording, drawn the redesign's way).
 */
function ItemState({ item, online, now }: { item: OutboxItem; online: boolean; now: number }) {
  const { colors } = useTheme();
  const state = itemState(item, online);
  const needsYou = state === "needs_you";
  const Icon = needsYou ? TriangleAlert : state === "sending" ? RefreshCw : Clock;
  const tried = lastTriedText(item, now);
  return (
    <View style={{ gap: 2, marginTop: 2 }} testID={`outbox-status-${item.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon size={14} color={needsYou ? colors.attention : colors.textSecondary} />
        <Text variant="caption" tone={needsYou ? "attention" : "secondary"} style={{ fontFamily: fontFamily.bodyBold }}>
          {stateLabel(state)}
        </Text>
      </View>
      <Text variant="caption" tone="secondary">
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
