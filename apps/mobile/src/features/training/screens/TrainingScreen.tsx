import { BookOpen, ClipboardCheck, GraduationCap, School, SunMedium, Users, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Masthead, Screen, Text } from "@/components";
import { openWebPage, SkeletonRows, StateMessage, useMe } from "@/features/shell";
import { displayName } from "@/lib/api";
import { touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { dayLabel, sectionsFor, trainingRole, type SectionId } from "../logic";
import { strings } from "../strings";

const ICONS: Record<SectionId, LucideIcon> = {
  today: SunMedium,
  schools: School,
  applicants: ClipboardCheck,
  people: Users,
  students: Users,
  myStudents: Users,
  grades: GraduationCap,
};

// The Training tab (redesign 48i): a switcher of this person's sections
// at the top, then the section. T2 is the frame only; each section's
// content arrives with its own slice (Today T4, students and check-ins T3,
// grades and applicants T6). Until then every section says what it will
// hold, and the web Training module is one tap away.
export function TrainingScreen({ now = new Date() }: { now?: Date }) {
  const { status, me } = useMe();
  const sections = sectionsFor(me);
  const role = trainingRole(me);
  const [picked, setPicked] = useState<SectionId>("today");
  const current: SectionId = sections.includes(picked) ? picked : (sections[0] ?? "today");

  if (!me && status === "loading") {
    return (
      <Screen>
        <SkeletonRows label={strings.loading} />
      </Screen>
    );
  }

  if (!role) {
    return (
      <Screen>
        <StateMessage testID="training-no-access" icon={BookOpen} title={strings.noAccess.title} body={strings.noAccess.body} />
      </Screen>
    );
  }

  const title = current === "today" ? strings.titles.today(me ? displayName(me) : "") : strings.titles[current];

  return (
    <Screen scroll={false} edges={["top"]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0, gap: 0 }}>
      <SectionSwitcher sections={sections} current={current} onPick={setPicked} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}>
        <Masthead context={`${dayLabel(now)} · ${strings.scope[role].toUpperCase()}`} title={title} />
        <SectionBody section={current} />
      </ScrollView>
    </Screen>
  );
}

export default TrainingScreen;

function SectionSwitcher({
  sections,
  current,
  onPick,
}: {
  sections: readonly SectionId[];
  current: SectionId;
  onPick: (s: SectionId) => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={strings.switcherLabel}
      style={{ flexDirection: "row", borderBottomWidth: 1.5, borderBottomColor: colors.text }}
    >
      {sections.map((s, i) => {
        const on = s === current;
        return (
          <Pressable
            key={s}
            testID={`training-section-${s}`}
            accessibilityRole="tab"
            accessibilityLabel={strings.sections[s]}
            accessibilityHint={`${i + 1} of ${sections.length}`}
            accessibilityState={{ selected: on }}
            onPress={() => onPick(s)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: touch.minTarget,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 4,
              backgroundColor: on ? colors.inverse : pressed ? colors.surface : "transparent",
            })}
          >
            <Text
              variant="monoLabel"
              tone={on ? "onInverse" : "default"}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={1.6}
            >
              {strings.sections[s]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionBody({ section }: { section: SectionId }) {
  const { colors } = useTheme();
  const copy = strings.empty[section];
  // Today is built from signals in the Hub (T4); there is nothing on the
  // website to send people to. Every other section exists on the web today.
  const web = section === "today" ? {} : { actionLabel: strings.openWeb, onAction: () => void openWebPage("/schools", colors) };
  return <StateMessage testID={`training-empty-${section}`} icon={ICONS[section]} title={copy.title} body={copy.body} {...web} />;
}
