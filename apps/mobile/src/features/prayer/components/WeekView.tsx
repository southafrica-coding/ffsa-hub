import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { Banner, Button, Text } from "@/components";
import { SectionBar, SkeletonRows, StateMessage } from "@/features/shell";

import { useWeek } from "../hooks";
import {
  blockoutWhen,
  dayLabel,
  friendlyError,
  groupWeek,
  isForbidden,
  isOfflineError,
  needsALead,
  savedAtLabel,
  spokenDate,
  weekRangeLabel,
  weekSummary,
  type PrayerAccess,
} from "../logic";
import { strings } from "../strings";

import { Frame } from "./Frame";
import { SetRow } from "./SetRow";
import { SetSheet } from "./SetSheet";
import { ErrorState } from "./ui";

/**
 * The wall on a phone (frame 11b): the week as a vertical run of days, each
 * set a row you can open. The screen's ONE yellow band is the web's: sets
 * nobody leads yet.
 */
export function WeekView({
  anchor,
  nav,
  userId,
  access,
  now,
}: {
  anchor: string;
  nav: ReactNode;
  userId: string | null;
  access: PrayerAccess;
  now: () => Date;
}) {
  const week = useWeek(anchor);
  const [openId, setOpenId] = useState<string | null>(null);
  const label = weekRangeLabel(anchor);

  if (week.status === "loading") {
    return (
      <Frame context={label} nav={nav}>
        <SkeletonRows count={5} label={strings.week.loading} />
      </Frame>
    );
  }

  if (week.status === "error") {
    return (
      <Frame context={label} nav={nav} onRefresh={week.refresh} refreshing={week.refreshing}>
        {isForbidden(week.error) ? (
          <StateMessage title={strings.errors.forbiddenTitle} body={strings.errors.forbiddenBody} testID="forbidden" />
        ) : (
          <ErrorState message={friendlyError(week.error)} onRetry={week.refresh} />
        )}
      </Frame>
    );
  }

  const { sets, blockouts, meta } = week.data;
  const summary = weekSummary(sets);
  const days = groupWeek(anchor, sets, blockouts);
  const needLead = days.flatMap((d) => d.sets).filter((s) => needsALead(s, meta.seatTypes));
  const offline = week.stale && week.refreshError !== null && isOfflineError(week.refreshError);
  const failed = week.stale && week.refreshError !== null && !offline;

  return (
    <Frame
      context={strings.week.context(label, summary.sets, summary.open, summary.seats)}
      nav={nav}
      onRefresh={week.refresh}
      refreshing={week.refreshing}
    >
      {offline && week.savedAt ? (
        <Banner tone="info" title={strings.week.offline} testID="offline-banner">
          {strings.week.offlineBody(savedAtLabel(week.savedAt, now()))}
        </Banner>
      ) : null}
      {failed && week.savedAt ? (
        <Banner tone="danger" title={strings.week.staleTitle} testID="stale-banner">
          {`${friendlyError(week.refreshError)} ${strings.week.staleBody(savedAtLabel(week.savedAt, now()))}`}
        </Banner>
      ) : null}

      {needLead.length > 0 ? (
        <Banner
          tone="needsYou"
          testID="needs-lead-band"
          action={<Button label={strings.week.openFirst} variant="secondary" onPress={() => setOpenId(needLead[0].id)} />}
        >
          {strings.week.needLead(needLead.length)}
        </Banner>
      ) : null}

      {summary.sets === 0 ? (
        <StateMessage title={strings.week.emptyTitle} body={strings.week.emptyBody} testID="week-empty" />
      ) : null}

      {days.map((day) => (
        <View key={day.date} style={{ gap: 8 }} testID={`day-${day.date}`}>
          <View accessible accessibilityRole="header" accessibilityLabel={spokenDate(day.date)}>
            <SectionBar label={dayLabel(day.date)} />
          </View>
          {day.blockouts.map((b) => (
            <Banner key={b.id} tone="info">
              {strings.week.blocked(blockoutWhen(b), b.reason, b.relocation_note)}
            </Banner>
          ))}
          {day.sets.length === 0 && summary.sets > 0 ? <Text tone="secondary">{strings.week.nothingThisDay}</Text> : null}
          {day.sets.map((s) => (
            <SetRow
              key={s.id}
              set={s}
              seatTypes={meta.seatTypes}
              bands={meta.bands}
              userId={userId}
              onPress={() => setOpenId(s.id)}
            />
          ))}
        </View>
      ))}

      <SetSheet
        setId={openId}
        onClose={() => setOpenId(null)}
        onChanged={week.refresh}
        seatTypes={meta.seatTypes}
        bands={meta.bands}
        userId={userId}
        access={access}
      />
    </Frame>
  );
}
