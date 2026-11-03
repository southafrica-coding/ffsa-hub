import { Alert, Image, View } from "react-native";

import { Button, Text } from "@/components";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { formatMoney } from "../money";
import type { Outbox } from "../outbox/runner";
import type { OutboxItem } from "../outbox/state";
import { strings } from "../strings";

import { Tag } from "./ui";

export function statusText(i: OutboxItem): string {
  if (i.status === "failed") return strings.outbox.failed;
  if (i.status === "sending") return strings.outbox.sending;
  return strings.outbox.waiting;
}

function describe(i: OutboxItem): string {
  if (i.kind === "expense") {
    return `${i.payload.description} · ${formatMoney(i.payload.zar_amount, "ZAR")} · ${i.payload.expense_date}`;
  }
  return i.fileName;
}

/**
 * What's saved on this phone but not yet on FFSA Hub. Every item says so in
 * words, shows why it failed if it did, and offers Retry; Remove asks first,
 * because removing is the only way anything here is ever lost.
 */
export function OutboxList({ items, outbox }: { items: OutboxItem[]; outbox: Outbox }) {
  const { colors } = useTheme();
  if (items.length === 0) return null;

  function confirmDiscard(i: OutboxItem) {
    Alert.alert(strings.outbox.discardConfirmTitle, strings.outbox.discardConfirmBody, [
      { text: strings.expense.cancel, style: "cancel" },
      { text: strings.outbox.discard, style: "destructive", onPress: () => void outbox.discard(i.id) },
    ]);
  }

  return (
    <View style={{ borderWidth: hairline, borderColor: colors.attentionBorder }} testID="outbox-list">
      <View style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface }}>
        <Text variant="label">{strings.outbox.savedNotSent}</Text>
      </View>
      {items.map((i) => (
        <View
          key={i.id}
          style={{ padding: 12, gap: 8, borderTopWidth: hairline, borderTopColor: colors.rule }}
          testID={`outbox-item-${i.id}`}
        >
          <View
            accessible
            accessibilityLabel={`${i.kind === "expense" ? strings.outbox.pendingExpense : "Receipt photo"}: ${describe(i)}. ${statusText(i)}.${i.lastError ? ` ${i.lastError}` : ""}`}
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
              <Tag tone={i.status === "failed" ? "danger" : "attention"}>{statusText(i)}</Tag>
              {i.lastError ? (
                <Text variant="caption" tone={i.status === "failed" ? "danger" : "secondary"}>
                  {i.lastError}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button
              label={strings.outbox.retry}
              accessibilityLabel={`${strings.outbox.retry}: ${describe(i)}`}
              variant="secondary"
              accessibilityHint={strings.outbox.retryHint}
              disabled={i.status === "sending"}
              onPress={() => void outbox.retry(i.id)}
            />
            <Button
              label={strings.outbox.discard}
              accessibilityLabel={`${strings.outbox.discard}: ${describe(i)}`}
              variant="destructive"
              disabled={i.status === "sending"}
              onPress={() => confirmDiscard(i)}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
