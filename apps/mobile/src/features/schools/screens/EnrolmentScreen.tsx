import { useRouter } from "expo-router";
import { CalendarCheck, FileText, SearchX } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { type BackAction, Bleed, EmptyState, FadeIn, Freshness, GroupRow, LargeTitleScrollView, ListGroup, ListRow, LoadError, SectionTitle, SkeletonList, Text } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { hairline, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { Figure, StatusTag } from "../components/parts";
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

// One enrolment (frames 8.2, 8.6): status, who's walking with you, the grades
// strip (GPA is the screen's one big number), the courses with their dates
// and grades, and the transcript (which stays on the website). Read-only.
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

  const back: BackAction = { label: strings.list.title, onPress: () => router.back() };
  const data = state.status === "ready" ? state.data : null;

  if (state.status === "ready" && !data) {
    return (
      <LargeTitleScrollView eyebrow={strings.list.context} title={strings.list.title} back={back}>
        <Bleed>
          <ListGroup inset={false}>
            <EmptyState
              testID="not-found"
              card={false}
              icon={SearchX}
              title={s.notFoundTitle}
              body={s.notFound}
              actionLabel={strings.common.back}
              onAction={() => router.back()}
            />
          </ListGroup>
        </Bleed>
      </LargeTitleScrollView>
    );
  }

  const e = data?.enrolment ?? null;
  const programme = e?.programs ?? null;

  return (
    <LargeTitleScrollView
      eyebrow={e ? s.context(programme?.code ?? "", formatDate(e.enrolled_at) ?? "") : strings.list.context}
      title={e ? (programme?.name ?? strings.list.programmeFallback) : strings.list.title}
      back={back}
      contentContainerStyle={{ flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
    >
      {state.status === "loading" ? (
        <Bleed>
          <SkeletonList label={s.loading} count={5} inset={false} />
        </Bleed>
      ) : null}
      {state.status === "error" ? (
        <Bleed>
          <LoadError title={s.errorTitle} message={state.message} onRetry={retry} />
        </Bleed>
      ) : null}
      <Freshness state={state} onRetry={retry} bleed />

      {data && e ? <Body data={data} onAttendance={() => router.push("/schools/attendance")} onTranscript={() => void openWebPage(`/my-schools/${e.id}`, colors)} /> : null}
    </LargeTitleScrollView>
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
    <FadeIn style={{ gap: space.lg }}>
      <View style={{ gap: 6 }}>
        <View accessible accessibilityLabel={`${s.status}: ${status.label}`} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
          <Text variant="label">{s.status}</Text>
          <StatusTag label={status.label} tone={status.tone} testID="enrolment-status" />
        </View>
        {arrival ? (
          <Text variant="rowTitle" testID="arrival">
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
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          rowGap: space.md,
          columnGap: 20,
          borderTopWidth: hairline,
          borderBottomWidth: hairline,
          borderColor: colors.text,
          paddingVertical: space.md,
        }}
      >
        {summary.gpa !== null ? (
          <Figure label={s.gpa} value={summary.gpa.toFixed(2)} big />
        ) : (
          <View accessible style={{ flexBasis: "100%", gap: 2 }}>
            <Text variant="label">{s.gpa}</Text>
            <Text tone="secondary">{s.notGraded}</Text>
          </View>
        )}
        <Figure label={s.creditsEarned} value={String(summary.creditsEarned)} foot={s.creditsOf(totalCredits)} />
        <Figure label={s.creditsAttempted} value={String(summary.creditsAttempted)} />
      </View>

      <View>
        <SectionTitle title={s.courses} meta={String(summary.courses.length)} tight />
        {summary.courses.length === 0 ? (
          <Text tone="secondary" style={{ paddingVertical: space.sm }}>
            {s.noCourses}
          </Text>
        ) : (
          <Bleed>
            <ListGroup inset={false}>
              {summary.courses.map((c) => (
                <CourseRow key={c.id} course={c} mark={marks.get(c.id) ?? null} />
              ))}
            </ListGroup>
          </Bleed>
        )}
      </View>

      <Bleed>
        <ListGroup inset={false}>
          <ListRow icon={FileText} title={s.transcript} subtitle={s.transcriptSub} trailing="web" onPress={onTranscript} accessibilityHint={s.transcriptHint} testID="transcript" />
          <ListRow icon={CalendarCheck} title={s.attendance} subtitle={strings.list.attendanceRowSub} onPress={onAttendance} testID="attendance-row" />
        </ListGroup>
      </Bleed>
    </FadeIn>
  );
}

function CourseRow({ course: c, mark }: { course: CourseWithGrade; mark: "now" | "next" | null }) {
  const dates = formatRange(c.start_date, c.end_date) ?? strings.common.datesTbc;
  const meta = [c.code, c.credit_hours ? strings.list.creditHours(c.credit_hours) : null].filter(Boolean).join(" · ");
  const grade = c.letterGrade ? s.grade(c.letterGrade) : s.noGrade;
  const markLabel = mark === "now" ? s.now : mark === "next" ? s.next : null;
  return (
    <GroupRow
      accessibilityLabel={s.courseA11y([c.name, markLabel ?? "", dates, meta, grade])}
      testID={`course-${c.id}`}
      trail={
        c.letterGrade ? (
          <Text variant="sectionTitle">{grade}</Text>
        ) : (
          <Text variant="caption" tone="secondary" style={{ textAlign: "right" }}>
            {grade}
          </Text>
        )
      }
    >
      <Text variant="rowTitle">{c.name}</Text>
      <Text variant="caption" tone="secondary">
        {dates}
      </Text>
      {meta ? (
        <Text variant="caption" tone="secondary">
          {meta}
        </Text>
      ) : null}
      {markLabel ? (
        <View style={{ marginTop: 6 }}>
          <StatusTag label={markLabel} tone={mark === "now" ? "positive" : "default"} testID={`mark-${mark}`} />
        </View>
      ) : null}
    </GroupRow>
  );
}
