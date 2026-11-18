import { useRouter } from "expo-router";
import { Users } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Text } from "@/components";
import { ErrorState, Skeleton, Tag } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { StateMessage } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { getStudents, loadErrorMessage, type Student, type StudentList, type StudentStatus } from "../api";
import { filterStudents, type StudentFilter } from "../logic";
import { strings } from "../strings";

const s = strings.list;

export const STATUS_TONE: Record<StudentStatus, "default" | "attention" | "positive" | "danger"> = {
  needs_care: "danger",
  no_checkin: "attention",
  on_track: "positive",
  arriving: "default",
};

// Students / My students (48c): a two-line list, filters instead of
// columns, every status in words. Tap opens the student's record.
export function StudentsSection({ onlyMine }: { onlyMine: boolean }) {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const load = useCallback(() => getStudents(apiFetch), []);
  const { state, retry } = useCachedLoad<StudentList>({ userId, cacheName: "training.students", load, errorMessage: loadErrorMessage });
  const [filter, setFilter] = useState<StudentFilter>("all");

  if (state.status === "loading") return <Skeleton label={s.loading} />;
  if (state.status === "error") return <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} />;

  const mine = filterStudents(state.data.students, "all", onlyMine);
  if (mine.length === 0) return <StateMessage testID="training-students-empty" icon={Users} title={s.emptyTitle} body={s.emptyBody} />;

  const count = (f: StudentFilter) => filterStudents(mine, f, false).length;
  const shown = filterStudents(mine, filter, false);
  const options: { value: StudentFilter; label: string }[] = [
    { value: "all", label: s.all(mine.length) },
    { value: "needs_care", label: s.needsCare(count("needs_care")) },
    { value: "no_checkin", label: s.noCheckin(count("no_checkin")) },
  ];

  return (
    <View style={{ gap: 12 }}>
      <FilterChips options={options} value={filter} onChange={setFilter} />
      {shown.length === 0 ? (
        <Text tone="secondary">{s.filteredEmpty}</Text>
      ) : (
        <View>
          {shown.map((st) => (
            <StudentRow key={st.enrollmentId} student={st} />
          ))}
        </View>
      )}
    </View>
  );
}

function FilterChips({
  options,
  value,
  onChange,
}: {
  options: { value: StudentFilter; label: string }[];
  value: StudentFilter;
  onChange: (v: StudentFilter) => void;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={s.filters} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={`training-filter-${o.value}`}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on, checked: on }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({
              minHeight: touch.minTarget - 8,
              paddingHorizontal: 12,
              justifyContent: "center",
              borderWidth: hairline,
              borderColor: on ? colors.inverse : colors.ruleStrong,
              backgroundColor: on ? colors.inverse : pressed ? colors.surface : "transparent",
            })}
          >
            <Text variant="label" tone={on ? "onInverse" : "default"}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StudentRow({ student }: { student: Student }) {
  const router = useRouter();
  const { colors } = useTheme();
  const last = student.lastCheckin;
  const meta = [student.programName, last ? s.lastCheckin(last.daysAgo, last.mood ? strings.mood[last.mood] : null) : s.never]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      testID={`training-student-${student.enrollmentId}`}
      accessibilityRole="button"
      accessibilityLabel={`${student.name}, ${strings.status[student.status]}`}
      accessibilityHint={meta}
      onPress={() => router.push({ pathname: "/training/student/[id]", params: { id: student.enrollmentId } })}
      style={({ pressed }) => ({
        minHeight: 64,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: hairline,
        borderBottomColor: colors.rule,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{student.name}</Text>
        <Text variant="caption" tone="secondary">
          {meta}
        </Text>
      </View>
      <Tag tone={STATUS_TONE[student.status]}>{strings.status[student.status]}</Tag>
    </Pressable>
  );
}
