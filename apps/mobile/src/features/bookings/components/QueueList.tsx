import { Clock, RefreshCw, TriangleAlert } from "lucide-react-native";
import { useSyncExternalStore } from "react";
import { Alert, Image, View } from "react-native";

import { Button, Text } from "@/components";
import { StoreProblemNotice, useNow } from "@/lib/outbox/OutboxStatus";
import { itemState, lastTriedText, stateDetail, stateLabel, statusSentence, summaryText } from "@/lib/outbox/status";
import { fontFamily, hairline, radius, space } from "@/theme/tokens";
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
 * What's saved on this phone but not on FFSA Hub yet (frames 7.12, 7.14):
 * one calm card, every item with its state in words (icon + word), what
 * happens next, and Retry / Remove. Remove asks first: it's the only way
 * anything here is ever lost.
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
  const now = useNow();
  if (items.length === 0 && !problem) return null;

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

  const summary = summaryText(items);
  return (
    <View testID="bookings-queue" style={{ gap: space.sm }}>
      <StoreProblemNotice problem={problem} onDismiss={() => outbox.dismissProblem()} />
      {items.length > 0 ? (
        <View style={{ borderWidth: hairline, borderColor: colors.attentionBorder, borderRadius: radius.card, backgroundColor: colors.raised, overflow: "hidden" }}>
          <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: 2, backgroundColor: colors.surface }}>
            {showTitle ? (
              <Text variant="label" tone="default" accessibilityRole="header">
                {q.title}
              </Text>
            ) : null}
            {summary ? (
              <Text variant="caption" tone="secondary" testID="bookings-queue-summary" accessibilityLiveRegion="polite">
                {summary}
              </Text>
            ) : null}
            {online ? null : (
              <Text variant="caption" tone="secondary">
                {q.offline}
              </Text>
            )}
          </View>
          {items.map((i) => (
            <View key={i.id} style={{ paddingHorizontal: space.md, paddingVertical: 10, gap: space.sm, borderTopWidth: hairline, borderTopColor: colors.rule }}>
              <View accessible accessibilityLabel={`${describe(i)}. ${statusSentence(i, online, now)}`} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                {i.kind === "photo" ? (
                  <Image
                    source={{ uri: i.localUri }}
                    style={{ width: 44, height: 44, borderRadius: radius.control, borderWidth: hairline, borderColor: colors.rule, backgroundColor: colors.surface }}
                    accessibilityIgnoresInvertColors
                    accessible={false}
                  />
                ) : null}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text variant="rowTitle">{describe(i)}</Text>
                  <ItemState item={i} online={online} now={now} />
                </View>
              </View>
              {i.status === "sending" ? null : (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button label={q.retry} variant="secondary" size="small" style={{ flex: 1 }} onPress={() => void outbox.retry(i.id)} accessibilityLabel={`${q.retry}: ${describe(i)}`} />
                  <Button label={q.remove} variant="danger" size="small" style={{ flex: 1 }} onPress={() => confirmRemove(i)} accessibilityLabel={`${q.remove}: ${describe(i)}`} />
                </View>
              )}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The item's state as an icon and a bold word, then what happens next and when it was last tried. */
function ItemState({ item, online, now }: { item: QueueItem; online: boolean; now: number }) {
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
