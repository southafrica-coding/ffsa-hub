import { CalendarDays, Lock } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { Banner, EmptyState, FadeIn, NeedsYouBand, SkeletonList, Text } from "@/components";
import { space } from "@/theme/tokens";

import { dayMarker, stripDays, stripSummary, stripWeek, type DayMarker } from "../day-strip";
import { useWeek } from "../hooks";
import {
  blockoutWhen,
  friendlyError,
  isForbidden,
  isOfflineError,
  needsALead,
  sastToday,
  savedAtLabel,
  type PrayerAccess,
} from "../logic";
import { strings } from "../strings";

import { DayStrip } from "./DayStrip";
import { Frame, type PrayerNav } from "./Frame";
import { SetRow } from "./SetRow";
import { SetSheet } from "./SetSheet";
import { DayHeader, ErrorState } from "./ui";

/**
 * The wall on a phone (frame 4.1): Monday to Friday as a day strip, and the
 * chosen day's sets as a vertical run, each a row you can open. The screen's
 * ONE yellow band is the web's: sets nobody leads yet.
 */
export function WeekView({
  anchor,
  day,
  onDay,
  nav,
  userId,
  access,
  now,
}: {
  anchor: string;
  /** The day of the strip that's showing. */
  day: string;
  onDay: (date: string) => void;
  nav: PrayerNav;
  userId: string | null;
  access: PrayerAccess;
  now: () => Date;
}) {
  const week = useWeek(anchor);
  const [openId, setOpenId] = useState<string | null>(null);
  const today = sastToday(now());

  if (week.status === "loading") {
    return (
      <Frame nav={nav}>
        <DayStrip days={stripDays(anchor)} selected={day} today={today} onSelect={onDay} />
        <SkeletonList count={4} label={strings.week.loading} inset={false} />
      </Frame>
    );
  }

  if (week.status === "error") {
    return (
      <Frame nav={nav} onRefresh={week.refresh} refreshing={week.refreshing}>
        {isForbidden(week.error) ? (
          <EmptyState icon={Lock} title={strings.errors.forbiddenTitle} body={strings.errors.forbiddenBody} testID="forbidden" />
        ) : (
          <ErrorState message={friendlyError(week.error)} onRetry={week.refresh} />
        )}
      </Frame>
    );
  }

  const { sets, blockouts, meta } = week.data;
  const days = stripWeek(anchor, sets, blockouts);
  const summary = stripSummary(days);
  const needLead = days.flatMap((d) => d.sets).filter((s) => needsALead(s, meta.seatTypes));
  const markers: Record<string, DayMarker | null> = Object.fromEntries(days.map((d) => [d.date, dayMarker(d, meta.seatTypes, userId)]));
  const shown = days.find((d) => d.date === day) ?? days[0];
  const offline = week.stale && week.refreshError !== null && isOfflineError(week.refreshError);
  const failed = week.stale && week.refreshError !== null && !offline;
  const emptyWeek = summary.sets === 0;

  return (
    <Frame
      nav={nav}
      summary={strings.week.summary(summary.sets, summary.open, summary.seats)}
      onRefresh={week.refresh}
      refreshing={week.refreshing}
    >
      {offline && week.savedAt ? (
        <Banner tone="offline" title={strings.week.offline} testID="offline-banner">
          {strings.week.offlineBody(savedAtLabel(week.savedAt, now()))}
        </Banner>
      ) : null}
      {failed && week.savedAt ? (
        <Banner
          tone="error"
          title={strings.week.staleTitle}
          testID="stale-banner"
          actionLabel={strings.errors.retry}
          onAction={week.refresh}
        >
          {`${friendlyError(week.refreshError)} ${strings.week.staleBody(savedAtLabel(week.savedAt, now()))}`}
        </Banner>
      ) : null}

      {needLead.length > 0 ? (
        <NeedsYouBand
          testID="needs-lead-band"
          eyebrow={strings.week.needLeadEyebrow}
          text={strings.week.needLead(needLead.length)}
          actionLabel={strings.week.openFirst}
          onAction={() => {
            // Show the day it's on behind the sheet, so closing lands there.
            onDay(needLead[0].set_date);
            setOpenId(needLead[0].id);
          }}
        />
      ) : null}

      <DayStrip days={days.map((d) => d.date)} selected={shown.date} today={today} markers={markers} onSelect={onDay} />

      {emptyWeek && shown.blockouts.length === 0 ? (
        <EmptyState icon={CalendarDays} title={strings.week.emptyTitle} body={strings.week.emptyBody} testID="week-empty" />
      ) : (
        <FadeIn>
          <View testID={`day-${shown.date}`}>
            <DayHeader date={shown.date} />
            <View style={{ gap: space.sm }}>
              {shown.blockouts.map((b) => (
                <Banner key={b.id} tone="info" icon={Lock} testID={`blockout-${b.id}`}>
                  {strings.week.blocked(blockoutWhen(b), b.reason, b.relocation_note)}
                </Banner>
              ))}
              {shown.sets.length === 0 ? (
                <Text variant="caption" tone="secondary">
                  {strings.week.nothingThisDay}
                </Text>
              ) : null}
              {shown.sets.map((s) => (
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
          </View>
        </FadeIn>
      )}

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
