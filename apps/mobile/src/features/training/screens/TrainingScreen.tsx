import { BookOpen, ClipboardCheck, GraduationCap, School, SunMedium, Users, type LucideIcon } from "lucide-react-native";
import { useState } from "react";

import { Bleed, EmptyState, LargeTitleScrollView, SegmentedControl, SkeletonList } from "@/components";
import { openWebPage, useMe } from "@/features/shell";
import { displayName } from "@/lib/api";
import { useTheme } from "@/theme/use-theme";

import { StudentsSection } from "../components/StudentsSection";
import { TodaySection } from "../components/TodaySection";
import { dayLabel, sectionsFor, trainingRole, type SectionId, type StudentFilter } from "../logic";
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

// The Training tab (redesign 48i, restyled with the kit in R4): the large
// title, this person's sections in a segmented control (at most four, see
// logic.ts SECTIONS), then the section. Today (T4) and Students / My
// students (T3) are live; grades and applicants (T6) still say what they will
// hold, with the web Training module one tap away.
export function TrainingScreen({ now = new Date() }: { now?: Date }) {
  const { status, me } = useMe();
  const sections = sectionsFor(me);
  const role = trainingRole(me);
  const [picked, setPicked] = useState<SectionId>("today");
  const [studentFilter, setStudentFilter] = useState<StudentFilter>("all");
  const current: SectionId = sections.includes(picked) ? picked : (sections[0] ?? "today");

  if (!me && status === "loading") {
    return (
      <LargeTitleScrollView title={strings.back}>
        <Bleed>
          <SkeletonList label={strings.loading} inset={false} />
        </Bleed>
      </LargeTitleScrollView>
    );
  }

  if (!role) {
    return (
      <LargeTitleScrollView title={strings.back}>
        <Bleed>
          <EmptyState testID="training-no-access" icon={BookOpen} title={strings.noAccess.title} body={strings.noAccess.body} />
        </Bleed>
      </LargeTitleScrollView>
    );
  }

  const title = current === "today" ? strings.titles.today(me ? displayName(me) : "") : strings.titles[current];

  return (
    <LargeTitleScrollView eyebrow={`${dayLabel(now)} · ${strings.scope[role]}`} title={title}>
      <SegmentedControl
        inset={false}
        items={sections.map((s) => ({ key: s, label: strings.sections[s] }))}
        value={current}
        onChange={(s) => {
          setStudentFilter("all");
          setPicked(s);
        }}
      />
      <SectionBody
        section={current}
        studentFilter={studentFilter}
        onOpenStudents={(filter) => {
          setStudentFilter(filter);
          setPicked(sections.includes("myStudents") ? "myStudents" : "students");
        }}
      />
    </LargeTitleScrollView>
  );
}

export default TrainingScreen;

function SectionBody({
  section,
  studentFilter,
  onOpenStudents,
}: {
  section: SectionId;
  studentFilter: StudentFilter;
  onOpenStudents: (filter: StudentFilter) => void;
}) {
  const { colors } = useTheme();
  if (section === "today") return <TodaySection onOpenStudents={onOpenStudents} />;
  if (section === "students" || section === "myStudents") {
    return <StudentsSection key={studentFilter} onlyMine={section === "myStudents"} initialFilter={studentFilter} />;
  }
  const copy = strings.empty[section];
  // Every section still waiting for its slice exists on the website today.
  return (
    <Bleed>
      <EmptyState
        testID={`training-empty-${section}`}
        icon={ICONS[section]}
        title={copy.title}
        body={copy.body}
        actionLabel={strings.openWeb}
        onAction={() => void openWebPage("/schools", colors)}
      />
    </Bleed>
  );
}
