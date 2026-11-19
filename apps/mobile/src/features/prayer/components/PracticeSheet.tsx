import { useState } from "react";
import { View } from "react-native";
import { Pressable } from "@/components/Pressable";

import { Banner, Button, Sheet, Text, selectionHaptic } from "@/components";
import { fontFamily, hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { bookStation, cancelPracticeBooking, type PracticeBooking, type PracticeWeek } from "../api";
import { prayerFetch } from "../api-client";
import { useAction, type ActionResult } from "../hooks";
import { dayLabel, hhmm, spokenDate, spokenTimeRange, timeRange } from "../logic";
import {
  blockedReason,
  bookingNames,
  canCancel,
  isMine,
  longerOption,
  preferredStation,
  rowState,
} from "../practice-logic";
import { strings } from "../strings";

import { ActionNotice, LabelRow } from "./ui";

/**
 * Booking a station (frame 4.5) for yourself: pick a free station from the
 * two-column grid, 30 or 60 minutes, book. Your own bookings in the row can
 * be cancelled here too. A full band, or a vocal group with other singers, is
 * booked on the website.
 */
export function PracticeSheet({
  week,
  target,
  userId,
  onClose,
  onChanged,
}: {
  week: PracticeWeek;
  target: { date: string; start: number } | null;
  userId: string | null;
  onClose: () => void;
  onChanged: (r: ActionResult) => void | Promise<void>;
}) {
  return (
    <Sheet
      visible={!!target}
      title={target ? `${dayLabel(target.date)} · ${hhmm(target.start)}` : strings.segments.practice}
      onClose={onClose}
      testID="practice-sheet"
    >
      {target ? (
        <Body key={`${target.date}-${target.start}`} week={week} date={target.date} start={target.start} userId={userId} onClose={onClose} onChanged={onChanged} />
      ) : null}
    </Sheet>
  );
}

function Body({
  week,
  date,
  start,
  userId,
  onClose,
  onChanged,
}: {
  week: PracticeWeek;
  date: string;
  start: number;
  userId: string | null;
  onClose: () => void;
  onChanged: (r: ActionResult) => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const { settings, stations, bookings } = week;
  const slot = settings.slot_minutes;
  const row = rowState(bookings, stations, date, start, start + slot);
  const [stationId, setStationId] = useState<string | null>(() => preferredStation(week, row));
  const [minutes, setMinutes] = useState(slot);
  const { busy, run } = useAction();
  const [result, setResult] = useState<ActionResult | null>(null);

  const station = stations.find((s) => s.id === stationId) ?? null;
  const longer = longerOption(week, date, start, station);
  const length = longer.ok ? minutes : slot;
  const end = start + length;
  const blocked = blockedReason(week, date, end);
  const range = `${hhmm(start)}–${hhmm(end)}`;

  const book = async () => {
    if (!station) return;
    const when = `${spokenDate(date)}, ${spokenTimeRange(hhmm(start), hhmm(end))}`;
    const r = await run(
      "book",
      {
        title: strings.practice.confirmBookTitle,
        body: strings.practice.confirmBookBody(station.label, when),
        confirm: strings.practice.book(station.label, range),
        cancel: strings.set.cancel,
      },
      () => bookStation(prayerFetch, { date, start: hhmm(start), end: hhmm(end), stationId: station.id }),
      strings.practice.booked(station.label, range),
    );
    if (!r) return;
    if (r.ok) {
      await onChanged(r);
      onClose();
    } else {
      // The database said no (someone got there first, the row filled, …).
      setResult(r);
    }
  };

  const cancel = async (b: PracticeBooking) => {
    const name = stations.find((s) => s.id === b.station_id)?.label ?? b.band_name ?? "";
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
    if (r.ok) {
      await onChanged(r);
      onClose();
    } else setResult(r);
  };

  // Under a band nothing else can be booked (rule 7): say whose room it is.
  if (row.band) {
    const b = row.band;
    return (
      <>
        <Banner tone="info" title={strings.practice.band(b.band_name ?? "")}>
          {strings.practice.bandRoom}
        </Banner>
        <Text variant="caption" tone="secondary">
          {timeRange(b.start_time, b.end_time)}
        </Text>
        {stations.map((s) => {
          const on = b.people.filter((p) => p.station_id === s.id);
          return (
            <View
              key={s.id}
              accessible
              accessibilityLabel={strings.a11y.bandStation(s.label, on.length ? on.map((p) => p.full_name).join(", ") : strings.practice.nobody)}
              style={{ flexDirection: "row", gap: space.md, paddingVertical: space.sm, borderBottomWidth: hairline, borderBottomColor: colors.rule }}
            >
              <Text variant="label" style={{ minWidth: 96, maxWidth: "45%", flexShrink: 1, paddingTop: 2 }}>
                {s.label}
              </Text>
              <Text variant={on.length ? "sectionTitle" : "caption"} tone={on.length ? "default" : "secondary"} style={{ flex: 1 }}>
                {on.length ? on.map((p) => p.full_name).join(", ") : strings.practice.nobody}
              </Text>
            </View>
          );
        })}
        <ActionNotice result={result} />
        {canCancel(b, userId, week) ? (
          <Button label={strings.practice.cancelBooking} variant="danger" onPress={() => cancel(b)} loading={busy === b.id} />
        ) : null}
      </>
    );
  }

  return (
    <>
      <LabelRow label={strings.practice.pickStation} right={strings.practice.takenCount(row.byStation.size, stations.length)} />
      {/* Two columns (frame 4.5); a cell grows with its text. */}
      <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
        {pairs(stations).map((pair) => (
          <View key={pair[0].id} style={{ flexDirection: "row", alignItems: "stretch", gap: 6 }}>
            {pair.map((s) => {
              const b = row.byStation.get(s.id);
              if (b) {
                const mine = isMine(b, userId);
                const who = mine ? strings.set.you : bookingNames(b);
                return (
                  <View
                    key={s.id}
                    testID={`station-${s.id}`}
                    accessible={!canCancel(b, userId, week)}
                    accessibilityLabel={strings.practice.stationA11y(s.label, strings.practice.taken(who))}
                    style={{
                      ...cell,
                      gap: mine ? 6 : 2,
                      backgroundColor: colors.surface,
                      borderWidth: mine ? 2 : hairline,
                      borderColor: mine ? colors.text : colors.rule,
                    }}
                  >
                    <Text variant="label">{s.label}</Text>
                    <Text variant="caption" tone={mine ? "default" : "secondary"} style={mine ? { fontFamily: fontFamily.bodySemibold } : undefined}>
                      {strings.practice.taken(who)}
                      {b.end_time > hhmm(start + slot) ? strings.practice.until(b.end_time) : ""}
                    </Text>
                    {canCancel(b, userId, week) ? (
                      <View style={{ flexDirection: "row" }}>
                        <Button
                          label={strings.practice.cancelBooking}
                          variant="danger"
                          size="small"
                          onPress={() => cancel(b)}
                          loading={busy === b.id}
                          disabled={!!busy}
                          accessibilityLabel={`${strings.practice.cancelBooking}: ${s.label}`}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              }
              const on = s.id === stationId;
              return (
                <Pressable
                  key={s.id}
                  testID={`station-${s.id}`}
                  accessibilityRole="radio"
                  accessibilityLabel={strings.practice.stationA11y(s.label, strings.practice.open)}
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    if (!on) selectionHaptic();
                    setStationId(s.id);
                  }}
                  style={({ pressed }) => ({
                    ...cell,
                    gap: 2,
                    justifyContent: "center",
                    backgroundColor: on ? colors.inverse : pressed ? colors.surface : colors.raised,
                    borderWidth: on ? 2 : hairline,
                    borderColor: on ? colors.inverse : colors.text,
                  })}
                >
                  <Text variant="label" tone={on ? "onInverse" : "default"}>
                    {s.label}
                  </Text>
                  <Text variant="caption" tone={on ? "onInverse" : "positive"}>
                    {on ? (s.id === week.me.defaultStationId ? strings.practice.yourInstrument : strings.practice.picked) : strings.practice.open}
                  </Text>
                </Pressable>
              );
            })}
            {pair.length === 1 ? <View style={{ flex: 1 }} /> : null}
          </View>
        ))}
      </View>

      {station ? (
        <View style={{ gap: space.xs }}>
          <LabelRow label={strings.practice.howLong} />
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: space.sm }}>
            {[slot, 2 * slot].map((m) => {
              const disabled = m > slot && !longer.ok;
              const on = length === m;
              return (
                <Pressable
                  key={m}
                  testID={`length-${m}`}
                  accessibilityRole="radio"
                  accessibilityLabel={strings.practice.minutes(m)}
                  accessibilityState={{ checked: on, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    if (!on) selectionHaptic();
                    setMinutes(m);
                  }}
                  style={{
                    flex: 1,
                    minHeight: touch.floor,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.control,
                    // Not on offer: a quiet filled block, like a disabled button.
                    backgroundColor: disabled ? colors.surface : on ? colors.inverse : colors.raised,
                    borderWidth: hairline,
                    borderColor: disabled ? colors.rule : on ? colors.inverse : colors.text,
                  }}
                >
                  <Text variant="sectionTitle" tone={disabled ? "tertiary" : on ? "onInverse" : "default"}>
                    {strings.practice.minutes(m)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {longer.note ? (
            <Text variant="caption" tone={longer.ok ? "positive" : "secondary"}>
              {longer.note}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text variant="caption" tone="secondary">
          {strings.practice.everyStationTaken}
        </Text>
      )}

      <ActionNotice result={result} />

      {station ? (
        <View style={{ gap: space.sm }}>
          {blocked ? (
            <Text variant="caption" tone="secondary" testID="blocked-reason">
              {blocked}
            </Text>
          ) : null}
          <Button
            label={strings.practice.book(station.label, range)}
            onPress={book}
            loading={busy === "book"}
            disabled={!!blocked || !!busy}
            accessibilityHint={blocked ? strings.a11y.bookBlockedHint(blocked) : undefined}
            testID="book-station"
          />
        </View>
      ) : null}

      <Text variant="caption" tone="secondary">
        {strings.practice.groupOnWeb}
      </Text>
    </>
  );
}

/** A station's cell in the two-column grid: 48pt at least, grows with its text. */
const cell = {
  flex: 1,
  minWidth: 0,
  minHeight: touch.minTarget,
  paddingVertical: 6,
  paddingHorizontal: 10,
  borderRadius: radius.control,
} as const;

function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}
