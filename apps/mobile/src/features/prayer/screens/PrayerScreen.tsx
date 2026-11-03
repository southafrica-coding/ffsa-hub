import { useState } from "react";
import { View } from "react-native";

import { useMe } from "@/features/shell";

import { MySetsView } from "../components/MySetsView";
import { PracticeView } from "../components/PracticeView";
import { Segments, WeekNav } from "../components/ui";
import { WeekView } from "../components/WeekView";
import { useUserId } from "../hooks";
import { prayerAccess, sastToday, shiftDays, weekRangeLabel, weekStart } from "../logic";
import { strings } from "../strings";

export type Section = "week" | "practice" | "mine";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "week", label: strings.segments.week },
  { key: "practice", label: strings.segments.practice },
  { key: "mine", label: strings.segments.mine },
];

/**
 * The Prayer tab. Open to everyone signed in, as on the web. Three sections
 * share one masthead: the week (the wall), practice, and my sets. Week and
 * practice share the week you're looking at.
 */
export function PrayerScreen({ now = () => new Date(), initialSection = "week" }: { now?: () => Date; initialSection?: Section }) {
  const { me } = useMe();
  const userId = useUserId();
  const access = prayerAccess(me);
  const [section, setSection] = useState<Section>(initialSection);
  const thisWeek = weekStart(sastToday(now()));
  const [anchor, setAnchor] = useState(thisWeek);

  const segments = <Segments items={SECTIONS} active={section} onChange={setSection} />;
  const nav =
    section === "mine" ? (
      segments
    ) : (
      <View style={{ gap: 12 }}>
        {segments}
        <WeekNav
          label={weekRangeLabel(anchor)}
          onPrev={() => setAnchor((a) => shiftDays(a, -7))}
          onNext={() => setAnchor((a) => shiftDays(a, 7))}
          onToday={() => setAnchor(thisWeek)}
          isThisWeek={anchor === thisWeek}
        />
      </View>
    );

  if (section === "practice") return <PracticeView anchor={anchor} nav={nav} userId={userId} />;
  if (section === "mine") return <MySetsView nav={nav} userId={userId} access={access} now={now} />;
  return <WeekView anchor={anchor} nav={nav} userId={userId} access={access} now={now} />;
}
