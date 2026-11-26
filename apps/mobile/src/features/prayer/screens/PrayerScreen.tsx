import { useState } from "react";

import { useMe } from "@/features/shell";

import type { PrayerNav, Section } from "../components/Frame";
import { MySetsView } from "../components/MySetsView";
import { PracticeView } from "../components/PracticeView";
import { WeekView } from "../components/WeekView";
import { currentWeekAnchor, defaultDay, weekdayRangeLabel } from "../day-strip";
import { useUserId } from "../hooks";
import { prayerAccess, sastToday, shiftDays } from "../logic";
import { strings } from "../strings";

export type { Section };

/**
 * The Prayer tab. Open to everyone signed in, as on the web. Three sections
 * share one title: the week (the wall), practice, and my sets. Week and
 * practice share the week you're looking at, shown Monday to Friday; at a
 * weekend "this week" is the coming one.
 */
export function PrayerScreen({ now = () => new Date(), initialSection = "week" }: { now?: () => Date; initialSection?: Section }) {
  const { me } = useMe();
  const userId = useUserId();
  const access = prayerAccess(me);
  const [section, setSection] = useState<Section>(initialSection);
  const today = sastToday(now());
  const thisWeek = currentWeekAnchor(today);
  const [anchor, setAnchor] = useState(thisWeek);
  const [day, setDay] = useState(() => defaultDay(thisWeek, today));

  const goTo = (week: string) => {
    setAnchor(week);
    setDay(defaultDay(week, today));
  };
  const isThisWeek = anchor === thisWeek;
  const range = weekdayRangeLabel(anchor);

  const nav: PrayerNav = {
    section,
    onSection: setSection,
    week:
      section === "mine"
        ? null
        : {
            label: isThisWeek ? strings.week.rangeThisWeek(weekdayRangeLabel(anchor, { year: false })) : range,
            spokenLabel: isThisWeek ? strings.week.weekOfThis(range) : strings.week.weekOf(range),
            onPrev: () => goTo(shiftDays(anchor, -7)),
            onNext: () => goTo(shiftDays(anchor, 7)),
            onToday: () => goTo(thisWeek),
            isThisWeek,
          },
  };

  if (section === "practice") return <PracticeView anchor={anchor} nav={nav} userId={userId} />;
  if (section === "mine") return <MySetsView nav={nav} userId={userId} access={access} now={now} />;
  return <WeekView anchor={anchor} day={day} onDay={setDay} nav={nav} userId={userId} access={access} now={now} />;
}
