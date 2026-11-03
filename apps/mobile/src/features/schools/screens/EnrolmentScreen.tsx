import { useRouter } from "expo-router";
import { CalendarCheck, FileText, SearchX } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Masthead, Screen, Text } from "@/components";
import { ErrorState, Row, SectionBar, Skeleton } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { ListRow, StateMessage, openWebPage } from "@/features/shell";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { Figure, Freshness, StatusTag } from "../components/ui";
import { loadEnrolment, loadErrorMessage, type EnrolmentData } from "../data";
import {
  courseTiming,
  enrolmentStatus,
  formatDate,
  formatRange,
  isUuid,
  nextArrival,
  staffName,
  summariseGrades,
  todayISO,
  type CourseWithGrade,
} from "../logic";
import { strings } from "../strings";

const s = strings.detail;

// One enrolment: status, who's walking with you, the grades strip (GPA is the
// screen's one big number), the courses with their dates and grades, and the
// transcript (which stays on the website). Read-only.
export default function EnrolmentScreen({ id }: { id: string | undefined }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const validId = isUuid(id) ? id : null;

  const load = useCallback(
    () => (userId && validId ? loadEnrolment(userId, validId) : Promise.resolve<EnrolmentData | null>(null)),
    [userId, validId],
  );
  const { state, refreshing, refresh, retry } = useCachedLoad<EnrolmentData | null>({
    userId: validId ? userId : null,
    cacheName: `schools.enrolment.${validId ?? "none"}`,
    load,
    errorMessage: loadErrorMessage,
  });

  const data = state.status === "ready" ? state.data : null;

  if (state.status === "ready" && !data) {
    return (
      <Screen edges={[]}>
        <StateMessage testID="not-found" icon={SearchX} title={s.notFoundTitle} body={s.notFound} actionLabel={strings.common.back} onAction={() => router.back()} />
      </Screen>
    );
  }

  const e = data?.enrolment ?? null;
  const programme = e?.programs ?? null;
  const name = programme?.name ?? strings.list.programmeFallback;

  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text} colors={[colors.text]} />}
      >
        {e ? (
          <Masthead context={s.context(programme?.code ?? "", formatDate(e.enrolled_at) ?? "")} title={name} />
        ) : (
          <Masthead context={strings.list.context} title={strings.list.title} />
        )}

        {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
        {state.status === "error" ? <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} /> : null}
        <Freshness state={state} onRetry={retry} />

        {data && e ? <Body data={data} onAttendance={() => router.push("/schools/attendance")} onTranscript={() => void openWebPage(`/my-schools/${e.id}`, colors)} /> : null}
      </ScrollView>
    </Screen>
  );
}

function Body({ data, onAttendance, onTranscript }: { data: EnrolmentData; onAttendance: () => void; onTranscript: () => void }) {
  const { colors } = useTheme();
  const e = data.enrolment;
  const programme = e.programs;
  const status = enrolmentStatus(e.status);
  const staff = staffName(e.assigned_staff);
  const summary = summariseGrades(programme?.courses ?? [], data.grades);
  const today = todayISO();
  const marks = courseTiming(summary.courses, today);
  const arrival = nextArrival(summary.courses, today);
  const totalCredits = programme?.credit_hours || summary.creditsAttempted;

  return (
    <>
      <View style={{ gap: 8 }}>
        <View accessible accessibilityLabel={`${s.status}: ${status.label}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text variant="label" tone="secondary">
            {s.status}
          </Text>
          <StatusTag label={status.label} tone={status.tone} testID="enrolment-status" />
        </View>
        {arrival ? (
          <Text variant="bodyStrong" testID="arrival">
            {s.arrival(formatDate(arrival) ?? "")}
          </Text>
        ) : null}
        {staff ? (
          <Text tone="secondary" accessibilityLabel={`${s.contact}: ${staff}`}>
            {strings.list.walkingWith(staff)}
          </Text>
        ) : null}
      </View>

      {/* One big number per screen: the GPA (or a quiet note until graded). */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12, columnGap: 16, borderTopWidth: hairline, borderBottomWidth: hairline, borderColor: colors.text, paddingVertical: 14 }}>
        {summary.gpa !== null ? (
          <Figure label={s.gpa} value={summary.gpa.toFixed(2)} big />
        ) : (
          <View accessible style={{ flexBasis: "100%", gap: 4 }}>
            <Text variant="label" tone="secondary">
              {s.gpa}
            </Text>
            <Text tone="secondary">{s.notGraded}</Text>
          </View>
        )}
        <Figure label={s.creditsEarned} value={String(summary.creditsEarned)} foot={s.creditsOf(totalCredits)} />
        <Figure label={s.creditsAttempted} value={String(summary.creditsAttempted)} />
      </View>

      <View>
        <SectionBar title={s.courses} meta={String(summary.courses.length)} />
        {summary.courses.length === 0 ? (
          <Text tone="secondary" style={{ paddingVertical: 16 }}>
            {s.noCourses}
          </Text>
        ) : (
          summary.courses.map((c) => <CourseRow key={c.id} course={c} mark={marks.get(c.id) ?? null} />)
        )}
      </View>

      <View>
        <ListRow icon={FileText} title={s.transcript} subtitle={s.transcriptSub} trailing="web" onPress={onTranscript} accessibilityHint={s.transcriptHint} testID="transcript" />
        <ListRow icon={CalendarCheck} title={s.attendance} subtitle={strings.list.attendanceRowSub} onPress={onAttendance} testID="attendance-row" />
      </View>
    </>
  );
}

function CourseRow({ course: c, mark }: { course: CourseWithGrade; mark: "now" | "next" | null }) {
  const dates = formatRange(c.start_date, c.end_date) ?? strings.common.datesTbc;
  const meta = [c.code, c.credit_hours ? strings.list.creditHours(c.credit_hours) : null].filter(Boolean).join(" · ");
  const grade = c.letterGrade ? s.grade(c.letterGrade) : s.noGrade;
  const markLabel = mark === "now" ? s.now : mark === "next" ? s.next : null;
  return (
    <Row accessibilityLabel={s.courseA11y([c.name, markLabel ?? "", dates, meta, grade])} testID={`course-${c.id}`}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="bodyStrong">{c.name}</Text>
          <Text variant="caption" tone="secondary">
            {dates}
          </Text>
          {meta ? (
            <Text variant="caption" tone="secondary">
              {meta}
            </Text>
          ) : null}
          {markLabel ? <StatusTag label={markLabel} tone={mark === "now" ? "positive" : "default"} testID={`mark-${mark}`} /> : null}
        </View>
        <Text variant={c.letterGrade ? "bodyStrong" : "caption"} tone={c.letterGrade ? "default" : "secondary"}>
          {grade}
        </Text>
      </View>
    </Row>
  );
}
