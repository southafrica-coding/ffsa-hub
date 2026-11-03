import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Banner, Button, Text } from "@/components";
import { SectionBar, SkeletonRows, StateMessage } from "@/features/shell";
import { hairline, touch } from "@/theme/tokens";
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
  weekRangeLabel,
} from "../logic";
import {
  canCancel,
  isClosedDay,
  isOpenYet,
  isPast,
  myPracticeBookings,
  opensLabel,
  practiceRows,
  rowState,
  stationName,
} from "../practice-logic";
import { strings } from "../strings";

import { Frame } from "./Frame";
import { PracticeSheet } from "./PracticeSheet";
import { ActionNotice, ErrorState } from "./ui";

/**
 * Practice (web frames 36a–36e) on a phone: my bookings this week with a
 * cancel, then each weekday's 30-minute rows. Tap a row to book a station.
 * Practice is not prayer room cover: it never touches the wall's sets.
 */
export function PracticeView({ anchor, nav, userId }: { anchor: string; nav: ReactNode; userId: string | null }) {
  const { colors } = useTheme();
  const { state, reload, retry, refreshing } = usePracticeWeek(anchor);
  const { busy, run } = useAction();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [target, setTarget] = useState<{ date: string; start: number } | null>(null);
  const context = `${strings.segments.practice} · ${weekRangeLabel(anchor)}`;

  if (state.status === "loading") {
    return (
      <Frame context={context} nav={nav}>
        <SkeletonRows count={4} label={strings.practice.loading} />
      </Frame>
    );
  }
  if (state.status === "error") {
    return (
      <Frame context={context} nav={nav} onRefresh={retry}>
        {isForbidden(state.error) ? (
          <StateMessage title={strings.errors.forbiddenTitle} body={strings.errors.forbiddenBody} testID="forbidden" />
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
    <Frame context={context} nav={nav} onRefresh={reload} refreshing={refreshing}>
      <Text tone="secondary">{strings.practice.intro(settings.start_time, settings.end_time, settings.max_minutes)}</Text>
      {!week.me.canBook ? <Banner tone="info">{strings.practice.cantBook}</Banner> : null}
      {week.me.canBook && !isOpenYet(week) ? (
        <Banner tone="info" testID="not-open">
          {strings.practice.notOpenYet(opensLabel(week.opensAt))}
        </Banner>
      ) : null}
      <ActionNotice result={result} />

      <View>
        <SectionBar label={strings.practice.yours} />
        {mine.length === 0 ? <Text tone="secondary" style={{ paddingVertical: 12 }}>{strings.practice.noneYours}</Text> : null}
        {mine.map((b) => (
          <View
            key={b.id}
            testID={`my-practice-${b.id}`}
            style={{ paddingVertical: 10, gap: 8, borderBottomWidth: hairline, borderBottomColor: colors.rule }}
          >
            <View accessible accessibilityLabel={`${stationName(week, b)}, ${spokenDate(b.practice_date)}, ${spokenTimeRange(b.start_time, b.end_time)}`}>
              <Text variant="bodyStrong">{stationName(week, b)}</Text>
              <Text variant="caption" tone="secondary">
                {dayLabel(b.practice_date)} · {timeRange(b.start_time, b.end_time)}
              </Text>
            </View>
            {canCancel(b, userId, week) && !isPast(week, b.practice_date, toMin(b.end_time)) ? (
              <View style={{ flexDirection: "row" }}>
                <Button
                  label={strings.practice.cancelBooking}
                  variant="destructive"
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

      {week.days.map((date) => (
        <View key={date} style={{ gap: 6 }} testID={`practice-day-${date}`}>
          <View accessible accessibilityRole="header" accessibilityLabel={spokenDate(date)}>
            <SectionBar label={dayLabel(date)} />
          </View>
          {isClosedDay(settings, date) ? (
            <Text tone="secondary">{strings.practice.closedDay(settings.closed_label)}</Text>
          ) : (
            practiceRows(settings).map((r) => (
              <PracticeRow
                key={r.start}
                week={week}
                date={date}
                start={r.start}
                end={r.end}
                onPress={() => setTarget({ date, start: r.start })}
              />
            ))
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

function PracticeRow({
  week,
  date,
  start,
  end,
  onPress,
}: {
  week: PracticeWeek;
  date: string;
  start: number;
  end: number;
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
  return (
    <Pressable
      testID={`practice-row-${date}-${hhmm(start)}`}
      accessibilityRole="button"
      accessibilityLabel={`${spokenTimeRange(hhmm(start), hhmm(end))}, ${state}${gone ? `, ${strings.practice.gone}` : ""}`}
      accessibilityHint={strings.practice.rowHint}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch.minTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: pressed ? colors.surfaceStrong : row.band ? colors.surface : colors.bg,
        borderWidth: row.band ? 2 : hairline,
        borderColor: row.band ? colors.text : colors.rule,
        opacity: gone ? 0.6 : 1,
      })}
    >
      <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"], width: 104 }}>
        {label}
      </Text>
      <Text tone={row.open > 0 && !row.band ? "positive" : "secondary"} style={{ flex: 1 }}>
        {gone ? strings.practice.gone : state}
      </Text>
    </Pressable>
  );
}
