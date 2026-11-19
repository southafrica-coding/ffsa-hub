import { ChevronRight, Lock } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Banner, Button, EmptyState, SectionHeader, SkeletonList, StatusChip, Text } from "@/components";
import { fontFamily, hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { cancelPracticeBooking, type PracticeBooking, type PracticeWeek } from "../api";
import { prayerFetch } from "../api-client";
import { useAction, usePracticeWeek, type ActionResult } from "../hooks";
import {
  dayLabel,
  friendlyError,
  hhmm,
  isForbidden,
  spokenDate,
  spokenTimeRange,
  timeRange,
  toMin,
} from "../logic";
import {
  bookingNames,
  canCancel,
  isClosedDay,
  isMine,
  isOpenYet,
  isPast,
  myPracticeBookings,
  opensLabel,
  practiceRows,
  rowState,
  stationName,
} from "../practice-logic";
import { strings } from "../strings";

import { Frame, type PrayerNav } from "./Frame";
import { PracticeSheet } from "./PracticeSheet";
import { ActionNotice, DayHeader, ErrorState } from "./ui";

/**
 * Practice (frames 4.4–4.6) on a phone: my bookings this week with a cancel,
 * then each weekday's 30-minute rows. Tap a row to book a station. Practice
 * is not prayer room cover: it never touches the wall's sets.
 */
export function PracticeView({ anchor, nav, userId }: { anchor: string; nav: PrayerNav; userId: string | null }) {
  const { colors } = useTheme();
  const { state, reload, retry, refreshing } = usePracticeWeek(anchor);
  const { busy, run } = useAction();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [target, setTarget] = useState<{ date: string; start: number } | null>(null);

  if (state.status === "loading") {
    return (
      <Frame nav={nav}>
        <SkeletonList count={4} label={strings.practice.loading} inset={false} />
      </Frame>
    );
  }
  if (state.status === "error") {
    return (
      <Frame nav={nav} onRefresh={retry}>
        {isForbidden(state.error) ? (
          <EmptyState icon={Lock} title={strings.errors.forbiddenTitle} body={strings.errors.forbiddenBody} testID="forbidden" />
        ) : (
          <ErrorState message={friendlyError(state.error)} onRetry={retry} />
        )}
      </Frame>
    );
  }

  const week = state.data;
  const { settings, stations } = week;
  const mine = myPracticeBookings(week, userId);

  const cancel = async (b: PracticeBooking) => {
    const name = stationName(week, b);
    const when = `${spokenDate(b.practice_date)}, ${spokenTimeRange(b.start_time, b.end_time)}`;
    const r = await run(
      b.id,
      {
        title: strings.practice.confirmCancelTitle,
        body: strings.practice.confirmCancelBody(name, when),
        confirm: strings.practice.cancelBooking,
        cancel: strings.practice.keep,
        destructive: true,
      },
      () => cancelPracticeBooking(prayerFetch, b.id),
      strings.practice.cancelled,
    );
    if (!r) return;
    setResult(r);
    await reload();
  };

  return (
    <Frame nav={nav} onRefresh={reload} refreshing={refreshing}>
      <Text variant="caption" tone="secondary">
        {strings.practice.intro(settings.start_time, settings.end_time, settings.max_minutes)}
      </Text>
      {!week.me.canBook ? <Banner tone="info">{strings.practice.cantBook}</Banner> : null}
      {week.me.canBook && !isOpenYet(week) ? (
        <Banner tone="queued" testID="not-open">
          {strings.practice.notOpenYet(opensLabel(week.opensAt))}
        </Banner>
      ) : null}
      <ActionNotice result={result} />

      <View>
        <SectionHeader title={strings.practice.yours} inset={false} tight />
        {mine.length === 0 ? (
          <Text variant="caption" tone="secondary">
            {strings.practice.noneYours}
          </Text>
        ) : null}
        <View style={{ gap: space.sm }}>
          {mine.map((b) => (
            <View
              key={b.id}
              testID={`my-practice-${b.id}`}
              style={{ padding: space.md, gap: space.sm, borderWidth: 2, borderColor: colors.text, borderRadius: radius.card }}
            >
              <View accessible accessibilityLabel={`${stationName(week, b)}, ${spokenDate(b.practice_date)}, ${spokenTimeRange(b.start_time, b.end_time)}`}>
                <Text variant="sectionTitle">{stationName(week, b)}</Text>
                <Text variant="caption" tone="secondary">
                  {dayLabel(b.practice_date)} · {timeRange(b.start_time, b.end_time)}
                </Text>
              </View>
              {canCancel(b, userId, week) && !isPast(week, b.practice_date, toMin(b.end_time)) ? (
                <View style={{ flexDirection: "row" }}>
                  <Button
                    label={strings.practice.cancelBooking}
                    variant="danger"
                    size="small"
                    onPress={() => cancel(b)}
                    loading={busy === b.id}
                    disabled={!!busy}
                    accessibilityLabel={`${strings.practice.cancelBooking}: ${stationName(week, b)}, ${dayLabel(b.practice_date)} ${timeRange(b.start_time, b.end_time)}`}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </View>

      {week.days.map((date) => (
        <View key={date} testID={`practice-day-${date}`}>
          <DayHeader date={date} />
          {isClosedDay(settings, date) ? (
            <Text variant="caption" tone="secondary">
              {strings.practice.closedDay(settings.closed_label)}
            </Text>
          ) : (
            <View style={{ gap: 6 }}>
              {practiceRows(settings).map((r) => (
                <PracticeRow
                  key={r.start}
                  week={week}
                  date={date}
                  start={r.start}
                  end={r.end}
                  userId={userId}
                  onPress={() => setTarget({ date, start: r.start })}
                />
              ))}
            </View>
          )}
        </View>
      ))}

      {stations.length > 0 ? (
        <PracticeSheet
          week={week}
          target={target}
          userId={userId}
          onClose={() => setTarget(null)}
          onChanged={async (r) => {
            setResult(r);
            await reload();
          }}
        />
      ) : null}
    </Frame>
  );
}

/**
 * One 30-minute step: the time, what's free in words, and a square per
 * station (taken = ink). A band row has a heavy border: the whole room is
 * theirs. Past rows fade and say so.
 */
function PracticeRow({
  week,
  date,
  start,
  end,
  userId,
  onPress,
}: {
  week: PracticeWeek;
  date: string;
  start: number;
  end: number;
  userId: string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const row = rowState(week.bookings, week.stations, date, start, end);
  const gone = isPast(week, date, end);
  const state = row.band
    ? strings.practice.band(row.band.band_name ?? "")
    : row.open === 0
      ? strings.practice.rowFull
      : strings.practice.rowFree(row.open, week.stations.length);
  const label = `${hhmm(start)}–${hhmm(end)}`;
  const taken = week.stations.filter((s) => row.byStation.has(s.id));
  const mine = (row.band ? isMine(row.band, userId) : false) || taken.some((s) => isMine(row.byStation.get(s.id)!, userId));
  const holders = taken.map((s) => {
    const b = row.byStation.get(s.id)!;
    return strings.a11y.stationHolder(s.label, isMine(b, userId) ? strings.set.you : bookingNames(b));
  });
  return (
    <Pressable
      testID={`practice-row-${date}-${hhmm(start)}`}
      accessibilityRole="button"
      accessibilityLabel={[
        `${spokenTimeRange(hhmm(start), hhmm(end))}, ${state}`,
        holders.length > 0 ? strings.a11y.practiceTaken(holders) : null,
        gone ? strings.practice.gone : null,
      ]
        .filter(Boolean)
        .join(". ")}
      accessibilityHint={strings.practice.rowHint}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch.minTarget,
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.card,
        backgroundColor: pressed ? colors.surfaceStrong : row.band ? colors.surface : colors.bg,
        borderWidth: row.band ? 2 : hairline,
        borderColor: row.band ? colors.text : colors.rule,
        opacity: gone ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Text variant="sectionTitle" style={{ fontFamily: fontFamily.mono, fontVariant: ["tabular-nums"], minWidth: 104 }}>
          {label}
        </Text>
        <Text variant="caption" tone={row.open > 0 && !row.band && !gone ? "positive" : "secondary"} style={{ flex: 1 }}>
          {gone ? strings.practice.gone : state}
        </Text>
        {mine ? <StatusChip label={strings.set.you} variant="ink" icon={null} /> : null}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ChevronRight size={16} color={colors.textTertiary} />
        </View>
      </View>
      {!row.band && week.stations.length > 0 ? (
        // One square per station, named; the words above and the spoken label say the same.
        <View
          testID={`practice-squares-${date}-${hhmm(start)}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}
        >
          {week.stations.map((s) => {
            const on = row.byStation.has(s.id);
            return (
              <View
                key={s.id}
                style={{
                  minHeight: 20,
                  paddingHorizontal: 6,
                  justifyContent: "center",
                  borderRadius: radius.control,
                  borderWidth: hairline,
                  borderColor: on ? colors.inverse : colors.ruleStrong,
                  backgroundColor: on ? colors.inverse : "transparent",
                }}
              >
                <Text variant="monoLabel" tone={on ? "onInverse" : "secondary"}>
                  {s.short_label || s.label}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </Pressable>
  );
}
