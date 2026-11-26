import type { ReactNode } from "react";
import { RefreshControl } from "react-native";

import { LargeTitleScrollView, SegmentedControl, type Segment } from "@/components";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { strings } from "../strings";

import { WeekNav, type WeekNavProps } from "./ui";

export type Section = "week" | "practice" | "mine";

const SECTIONS: readonly Segment<Section>[] = [
  { key: "week", label: strings.segments.week },
  { key: "practice", label: strings.segments.practice },
  { key: "mine", label: strings.segments.mine },
];

/** What every section draws under the title: the section strip and (Week, Practice) the week stepper. */
export type PrayerNav = {
  section: Section;
  onSection: (section: Section) => void;
  /** Null on My sets, which isn't tied to a week. */
  week: Omit<WeekNavProps, "summary"> | null;
};

/**
 * The Prayer Room page: the large title (PRAYER ROOM, the one caps moment),
 * the section strip, the week stepper, then the section's content, with
 * pull-to-refresh. Each section renders its own Frame so the refresh gesture
 * reloads what's on screen.
 */
export function Frame({
  nav,
  summary,
  children,
  onRefresh,
  refreshing = false,
}: {
  nav: PrayerNav;
  /** Under the week label: "9 sets · 6 seats open". */
  summary?: string;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <LargeTitleScrollView
      eyebrow={strings.eyebrow}
      title={strings.title}
      gap={space.md}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} /> : undefined
      }
    >
      <SegmentedControl items={SECTIONS} value={nav.section} onChange={nav.onSection} inset={false} />
      {nav.week ? <WeekNav {...nav.week} summary={summary} /> : null}
      {children}
    </LargeTitleScrollView>
  );
}
