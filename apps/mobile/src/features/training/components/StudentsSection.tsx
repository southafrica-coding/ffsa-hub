import { useRouter } from "expo-router";
import { Check, Clock, PlaneLanding, TriangleAlert, Users, type LucideIcon } from "lucide-react-native";
import { useCallback, useState } from "react";

import { useSession } from "@/auth/session-provider";
import { Bleed, ChoiceChips, EmptyState, FadeIn, Freshness, GroupRow, ListGroup, LoadError, SkeletonList, StatusChip, Text } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { apiFetch } from "@/lib/api-client";
import type { ChipVariant } from "@/theme/styles";
import { space } from "@/theme/tokens";

import { getStudents, loadErrorMessage, type Student, type StudentList, type StudentStatus } from "../api";
import { filterStudents, type StudentFilter } from "../logic";
import { strings } from "../strings";

const s = strings.list;

/** Every status is a word in a chip, with its own icon: never colour alone. */
export const STATUS_CHIP: Record<StudentStatus, { variant: ChipVariant; icon: LucideIcon }> = {
  needs_care: { variant: "danger", icon: TriangleAlert },
  no_checkin: { variant: "attention", icon: Clock },
  on_track: { variant: "positive", icon: Check },
  arriving: { variant: "neutral", icon: PlaneLanding },
};

export function StudentStatusChip({ status }: { status: StudentStatus }) {
  const chip = STATUS_CHIP[status];
  return <StatusChip label={strings.status[status]} variant={chip.variant} icon={chip.icon} />;
}

// Students / My students (48c): a two-line list, filters instead of
// columns, every status in words. Tap opens the student's record.
export function StudentsSection({ onlyMine, initialFilter = "all" }: { onlyMine: boolean; initialFilter?: StudentFilter }) {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const load = useCallback(() => getStudents(apiFetch), []);
  const { state, retry } = useCachedLoad<StudentList>({ userId, cacheName: "training.students", load, errorMessage: loadErrorMessage });
  // Opened from a Today line ("2 students haven't had a check-in"): start on
  // that filter. The parent remounts this section (key) when it changes.
  const [filter, setFilter] = useState<StudentFilter>(initialFilter);

  if (state.status === "loading") {
    return (
      <Bleed>
        <SkeletonList label={s.loading} inset={false} count={5} />
      </Bleed>
    );
  }
  if (state.status === "error") {
    return (
      <Bleed>
        <LoadError testID="training-students-error" title={s.errorTitle} message={state.message} onRetry={retry} />
      </Bleed>
    );
  }

  const mine = filterStudents(state.data.students, "all", onlyMine);
  if (mine.length === 0) {
    return (
      <FadeIn style={{ gap: space.lg }}>
        <Freshness state={state} onRetry={retry} bleed />
        <Bleed>
          <EmptyState testID="training-students-empty" icon={Users} title={s.emptyTitle} body={s.emptyBody} />
        </Bleed>
      </FadeIn>
    );
  }

  const count = (f: StudentFilter) => filterStudents(mine, f, false).length;
  const shown = filterStudents(mine, filter, false);
  const options: { value: StudentFilter; label: string }[] = [
    { value: "all", label: s.all(mine.length) },
    { value: "needs_care", label: s.needsCare(count("needs_care")) },
    { value: "no_checkin", label: s.noCheckin(count("no_checkin")) },
  ];

  return (
    <FadeIn style={{ gap: space.lg }}>
      <Freshness state={state} onRetry={retry} bleed />
      <ChoiceChips label={s.filters} labelPlacement="inline" options={options} value={filter} onChange={setFilter} />
      {shown.length === 0 ? (
        <Text tone="secondary">{s.filteredEmpty}</Text>
      ) : (
        <Bleed>
          <ListGroup inset={false}>
            {shown.map((st) => (
              <StudentRow key={st.enrollmentId} student={st} />
            ))}
          </ListGroup>
        </Bleed>
      )}
    </FadeIn>
  );
}

function StudentRow({ student }: { student: Student }) {
  const router = useRouter();
  const last = student.lastCheckin;
  const meta = [student.programName, last ? s.lastCheckin(last.daysAgo, last.mood ? strings.mood[last.mood] : null) : s.never]
    .filter(Boolean)
    .join(" · ");
  return (
    <GroupRow
      testID={`training-student-${student.enrollmentId}`}
      accessibilityLabel={`${student.name}, ${strings.status[student.status]}`}
      accessibilityHint={meta}
      onPress={() => router.push({ pathname: "/training/student/[id]", params: { id: student.enrollmentId } })}
    >
      <Text variant="rowTitle">{student.name}</Text>
      <Text variant="caption" tone="secondary">
        {meta}
      </Text>
      <StudentStatusChip status={student.status} />
    </GroupRow>
  );
}
