import { useRouter } from "expo-router";
import { Globe, Lock, UserCheck, X } from "lucide-react-native";
import { useCallback, useState } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Button, EmptyState, LargeTitleScrollView, ListGroup, ListRow, NeedsYouBand, SectionHeader, SkeletonList, StatusChip, Text } from "@/components";
import { Bleed, LoadError } from "@/features/finance/components/parts";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { getSchool, loadErrorMessage, type SchoolDetail, type StaffDecisionRow } from "../api";
import { DecisionSheet, type SheetStep } from "../components/DecisionSheet";
import { Freshness } from "../components/ui";
import { canMakeStaff, decidedLine, decisionWord, isUuid, needsDecisionCount, rowA11yLabel } from "../logic";
import { strings } from "../strings";

const s = strings.detail;

type Open = { row: StaffDecisionRow; step: SheetStep } | null;

// One Leadership Track school's students, the web staff_decision tab as
// rows: name, email, Staff tag, the decision in words, its note, and who
// decided when. Decide / Change opens a bottom sheet; a yes for someone who
// isn't staff yet offers Make staff. The page's one yellow band is "N
// students are still waiting on a decision", only while the school isn't
// archived. Arrival and the rest of the school page stay on the website.
export default function SchoolDetailScreen({ programId }: { programId: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const validId = isUuid(programId);

  const load = useCallback(
    () => (validId ? getSchool(apiFetch, programId) : Promise.reject(new Error("not found"))),
    [programId, validId],
  );
  // Both must be stable, or useCachedLoad reloads on every render.
  const errorMessage = useCallback((err: unknown) => (validId ? loadErrorMessage(err) : strings.common.notFound), [validId]);
  const { state, refreshing, refresh, retry } = useCachedLoad<SchoolDetail>({
    userId,
    cacheName: `staff-decisions.school.${validId ? programId : "invalid"}`,
    load,
    errorMessage,
  });

  const [open, setOpen] = useState<Open>(null);

  const data = state.status === "ready" ? state.data : null;
  const forbidden = state.status === "error" && state.message === strings.common.forbidden;
  const waiting = data ? needsDecisionCount(data) : 0;

  return (
    <>
      <LargeTitleScrollView
        back={{ label: strings.list.title, onPress: () => router.back() }}
        eyebrow={s.context}
        title={data ? data.school.name : strings.list.title}
        gap={0}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        {data ? (
          <View style={{ marginTop: -space.sm, gap: space.sm }}>
            {data.school.archived ? <StatusChip label={strings.list.archived} variant="quiet" icon={null} testID="archived" /> : null}
            <Text variant="caption" tone="secondary">
              {s.intro}
            </Text>
            <Text variant="sectionTitle" style={{ fontVariant: ["tabular-nums"] }} testID="counts">
              {s.counts(data.school.yes, data.school.no, data.school.undecided)}
            </Text>
          </View>
        ) : null}

        <Bleed style={{ gap: space.md, marginTop: data ? space.lg : 0 }}>
          {state.status === "loading" ? <SkeletonList label={s.loading} count={5} inset={false} /> : null}
          {forbidden ? (
            <EmptyState testID="forbidden" icon={Lock} title={strings.gate.title} body={strings.common.forbidden} />
          ) : state.status === "error" ? (
            <LoadError title={s.errorTitle} message={state.message} onRetry={retry} />
          ) : null}
          <Freshness state={state} onRetry={retry} />

          {/* The one yellow band. No button: each waiting student has Decide on their own row. */}
          {waiting > 0 ? (
            <NeedsYouBand eyebrow={s.needsYouTitle} text={waiting === 1 ? s.needsYouOne : s.needsYouMany(waiting)} testID="needs-you" />
          ) : null}
        </Bleed>

        {data ? (
          <>
            <SectionHeader title={s.studentsCount(data.rows.length)} inset={false} />
            <Bleed>
              {data.rows.length === 0 ? (
                <EmptyState testID="empty" icon={UserCheck} title={s.emptyTitle} body={s.emptyBody} />
              ) : (
                <ListGroup inset={false} testID="students">
                  {data.rows.map((row) => (
                    <StudentRow
                      key={row.enrollmentId}
                      row={row}
                      onDecide={() => setOpen({ row, step: "decide" })}
                      onMakeStaff={() => setOpen({ row, step: "make-staff" })}
                    />
                  ))}
                </ListGroup>
              )}
            </Bleed>

            <Bleed style={{ marginTop: space.lg }}>
              <ListGroup inset={false}>
                <ListRow
                  icon={Globe}
                  title={s.openWeb}
                  subtitle={s.openWebSub}
                  trailing="web"
                  accessibilityHint={s.openWebHint}
                  onPress={() => void openWebPage(`/schools/${data.school.id}?tab=staff_decision`, colors)}
                  testID="open-web"
                />
              </ListGroup>
            </Bleed>
          </>
        ) : null}
      </LargeTitleScrollView>

      {open && data ? (
        <DecisionSheet
          key={`${open.row.enrollmentId}:${open.step}`}
          row={open.row}
          initialStep={open.step}
          departmentOptions={data.departmentOptions}
          onClose={() => setOpen(null)}
          onChanged={refresh}
        />
      ) : null}
    </>
  );
}

function StudentRow({ row, onDecide, onMakeStaff }: { row: StaffDecisionRow; onDecide: () => void; onMakeStaff: () => void }) {
  const word = decisionWord(row);
  const decided = decidedLine(row);
  return (
    <View
      style={{ minHeight: 56, justifyContent: "center", paddingVertical: space.md, paddingLeft: space.lg, paddingRight: space.md, gap: space.md }}
      testID={`student-${row.enrollmentId}`}
    >
      {/* One stop for the screen reader: name, email, staff, decision, note, when. */}
      <View accessible accessibilityLabel={rowA11yLabel(row)} style={{ gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", columnGap: space.sm, rowGap: space.xs }}>
          <Text variant="rowTitle" style={{ flexShrink: 1 }}>
            {row.name}
          </Text>
          {row.isStaff ? <StatusChip label={s.staff} variant="positive" /> : null}
        </View>
        {row.email ? (
          <Text variant="caption" tone="secondary">
            {row.email}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {/* Yes = green + check, no = quiet + cross, undecided = dashed: a word and a shape each, never colour alone. */}
          {!row.decision ? (
            <StatusChip label={word.label} variant="dashed" />
          ) : row.decision.accepted ? (
            <StatusChip label={word.label} variant="positive" />
          ) : (
            <StatusChip label={word.label} variant="neutral" icon={X} />
          )}
        </View>
        {row.decision?.note ? (
          <Text variant="caption" numberOfLines={3} testID={`note-${row.enrollmentId}`} style={{ marginTop: space.xs }}>
            {s.noteLine(row.decision.note)}
          </Text>
        ) : null}
        {decided ? (
          <Text variant="caption" tone="secondary" style={{ marginTop: space.xs }}>
            {decided}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Button
          label={row.decision ? s.change : s.decide}
          variant={row.decision ? "secondary" : "primary"}
          size="small"
          accessibilityLabel={row.decision ? s.changeA11y(row.name) : s.decideA11y(row.name)}
          accessibilityHint={s.decideHint}
          onPress={onDecide}
          testID={`decide-${row.enrollmentId}`}
        />
        {canMakeStaff(row) ? (
          <Button
            label={s.makeStaff}
            variant="secondary"
            size="small"
            accessibilityLabel={s.makeStaffA11y(row.name)}
            accessibilityHint={s.makeStaffHint}
            onPress={onMakeStaff}
            testID={`make-staff-${row.enrollmentId}`}
          />
        ) : null}
      </View>
    </View>
  );
}
