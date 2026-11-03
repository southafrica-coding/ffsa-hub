import { useSyncExternalStore } from "react";
import { Alert, Image, View } from "react-native";

import { Button, Text } from "@/components";
import { OutboxItemStatus, OutboxSummary, StoreProblemNotice } from "@/lib/outbox/OutboxStatus";
import { itemState, stateLabel, statusSentence } from "@/lib/outbox/status";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { BookingsOutbox } from "../outbox/runner";
import type { QueueItem } from "../outbox/state";
import { strings } from "../strings";

const q = strings.queue;

/** The item's state in words (shared outbox wording). */
export function queueStatusText(i: QueueItem, online = true): string {
  return stateLabel(itemState(i, online));
}

function describe(i: QueueItem): string {
  if (i.kind === "form") return `${q.form(i.inspectionKind)} · ${i.bookingName}`;
  return `${strings.inspection.photos[i.photoKind]} · ${i.bookingName}`;
}

/**
 * What's saved on this phone but not on FFSA Hub yet, in words, with why it
 * failed and Retry. Remove asks first: it's the only way anything here is
 * ever lost.
 */
export function QueueList({
  items,
  outbox,
  online,
  showTitle = true,
  onRemoved,
}: {
  items: QueueItem[];
  outbox: BookingsOutbox;
  online: boolean;
  showTitle?: boolean;
  onRemoved?: (id: string) => void;
}) {
  const { colors } = useTheme();
  const problem = useSyncExternalStore(outbox.subscribe, outbox.getProblem, outbox.getProblem);
  if (items.length === 0 && !problem) return null;
  const now = Date.now();

  function confirmRemove(i: QueueItem) {
    Alert.alert(q.removeTitle, q.removeBody, [
      { text: strings.common.cancel, style: "cancel" },
      { text: q.remove, style: "destructive", onPress: () => {
          onRemoved?.(i.id);
          void outbox.discard(i.id);
        },
      },
    ]);
  }

  return (
    <View testID="bookings-queue" style={{ gap: 8 }}>
      <StoreProblemNotice problem={problem} onDismiss={() => outbox.dismissProblem()} />
      {showTitle && items.length > 0 ? <Text variant="label">{q.title}</Text> : null}
      <OutboxSummary items={items} testID="bookings-queue-summary" />
      {online ? null : (
        <Text variant="caption" tone="secondary">
          {q.offline}
        </Text>
      )}
      {items.map((i) => (
        <View key={i.id} style={{ flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: hairline, borderBottomColor: colors.rule }}>
          {i.kind === "photo" ? (
            <Image source={{ uri: i.localUri }} style={{ width: 56, height: 56, backgroundColor: colors.surface }} accessibilityIgnoresInvertColors accessible={false} />
          ) : null}
          <View style={{ flex: 1, gap: 4 }}>
            <View accessible accessibilityLabel={`${describe(i)}. ${statusSentence(i, online, now)}`} style={{ gap: 4 }}>
              <Text>{describe(i)}</Text>
              <OutboxItemStatus item={i} online={online} now={now} />
            </View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {i.status !== "sending" ? (
                <Button label={q.retry} variant="secondary" onPress={() => void outbox.retry(i.id)} accessibilityLabel={`${q.retry}: ${describe(i)}`} />
              ) : null}
              {i.status !== "sending" ? (
                <Button label={q.remove} variant="ghost" onPress={() => confirmRemove(i)} accessibilityLabel={`${q.remove}: ${describe(i)}`} />
              ) : null}
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}
