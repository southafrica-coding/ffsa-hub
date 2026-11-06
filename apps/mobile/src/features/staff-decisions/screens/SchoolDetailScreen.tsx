import { ExternalLink, UserCheck } from "lucide-react-native";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Masthead, Screen, Text } from "@/components";
import { ErrorState, SectionBar, Skeleton, Tag } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { Freshness, StatusTag } from "@/features/schools/components/ui";
import { ListRow, StateMessage, openWebPage } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";
import { hairline, touch } from "@/theme/tokens";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { getSchool, loadErrorMessage, type SchoolDetail, type StaffDecisionRow } from "../api";
import { DecisionSheet, type SheetStep } from "../components/DecisionSheet";
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
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        <Masthead context={s.context} title={data ? data.school.name : strings.list.title} />

        {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
        {forbidden ? (
          <StateMessage testID="forbidden" icon={UserCheck} title={strings.gate.title} body={strings.common.forbidden} />
        ) : state.status === "error" ? (
          <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} />
        ) : null}
        <Freshness state={state} onRetry={retry} />

        {waiting > 0 ? (
          <Banner tone="needsYou" title={s.needsYouTitle} testID="needs-you">
            {waiting === 1 ? s.needsYouOne : s.needsYouMany(waiting)}
          </Banner>
        ) : null}

        {data ? (
          <>
            {data.school.archived ? <StatusTag label={strings.list.archived} tone="default" testID="archived" /> : null}
            <Text tone="secondary">{s.intro}</Text>

            <View>
              <SectionBar title={s.students} meta={s.counts(data.school.yes, data.school.no, data.school.undecided)} />
              {data.rows.length === 0 ? (
                <StateMessage testID="empty" icon={UserCheck} title={s.emptyTitle} body={s.emptyBody} />
              ) : (
                data.rows.map((row) => (
                  <StudentRow
                    key={row.enrollmentId}
                    row={row}
                    onDecide={() => setOpen({ row, step: "decide" })}
                    onMakeStaff={() => setOpen({ row, step: "make-staff" })}
                  />
                ))
              )}
            </View>

            <View>
              <ListRow
                icon={ExternalLink}
                title={s.openWeb}
                subtitle={s.openWebSub}
                trailing="web"
                accessibilityHint={s.openWebHint}
                onPress={() => void openWebPage(`/schools/${data.school.id}?tab=staff_decision`, colors)}
                testID="open-web"
              />
            </View>
          </>
        ) : null}
      </ScrollView>

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
    </Screen>
  );
}

function StudentRow({ row, onDecide, onMakeStaff }: { row: StaffDecisionRow; onDecide: () => void; onMakeStaff: () => void }) {
  const { colors } = useTheme();
  const word = decisionWord(row);
  const decided = decidedLine(row);
  return (
    <View
      style={{ minHeight: touch.minTarget, paddingVertical: 12, borderBottomWidth: hairline, borderBottomColor: colors.rule, gap: 8 }}
      testID={`student-${row.enrollmentId}`}
    >
      {/* One stop for the screen reader: name, email, staff, decision, note, when. */}
      <View accessible accessibilityLabel={rowA11yLabel(row)} style={{ gap: 4 }}>
        <Text variant="bodyStrong">{row.name}</Text>
        {row.email ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {row.email}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Tag tone={word.tone}>{word.label}</Tag>
          {row.isStaff ? <Tag tone="positive">{s.staff}</Tag> : null}
        </View>
        {row.decision?.note ? (
          <Text tone="secondary" numberOfLines={3} testID={`note-${row.enrollmentId}`}>
            {row.decision.note}
          </Text>
        ) : null}
        {decided ? (
          <Text variant="caption" tone="secondary">
            {decided}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          label={row.decision ? s.change : s.decide}
          variant={row.decision ? "secondary" : "primary"}
          accessibilityLabel={row.decision ? s.changeA11y(row.name) : s.decideA11y(row.name)}
          accessibilityHint={s.decideHint}
          onPress={onDecide}
          testID={`decide-${row.enrollmentId}`}
        />
        {canMakeStaff(row) ? (
          <Button
            label={s.makeStaff}
            variant="secondary"
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
