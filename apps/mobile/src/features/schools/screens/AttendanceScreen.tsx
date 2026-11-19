import { useRouter } from "expo-router";
import { CalendarCheck } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { EmptyState, LargeTitleScrollView, ListGroup, SkeletonList, Text } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { refreshControlColors } from "@/theme/styles";
import { hairline, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { BIG_KPI, Bleed, DateBlock, Freshness, GroupRow, LoadError, SectionCount, StatusTag } from "../components/parts";
import { loadAttendance, loadErrorMessage } from "../data";
import { attendanceStatus, dayAndMonth, formatDate, formatTime, summariseAttendance } from "../logic";
import { strings } from "../strings";
import type { AttendanceRecord } from "../types";

const s = strings.attendance;

// My Attendance (frame 8.3): the share of sessions the person was present at
// (the screen's one big number, as on the web), a count per status in words,
// then every record. Read-only; staff take attendance on the website.
export default function AttendanceScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;

  const load = useCallback(() => (userId ? loadAttendance(userId) : Promise.reject(new Error("signed out"))), [userId]);
  const { state, refreshing, refresh, retry } = useCachedLoad<AttendanceRecord[]>({
    userId,
    cacheName: "schools.attendance",
    load,
    errorMessage: loadErrorMessage,
  });

  const rows = state.status === "ready" ? state.data : [];
  const summary = summariseAttendance(rows);

  return (
    <LargeTitleScrollView
      eyebrow={s.context}
      title={s.title}
      back={{ label: strings.list.title, onPress: () => router.back() }}
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
      <Freshness state={state} onRetry={retry} />

      {summary.pct !== null ? (
        <View
          accessible
          accessibilityLabel={strings.a11y.withBreakdown(
            s.summaryA11y(summary.pct, summary.present, summary.total),
            summary.byStatus.map((b) => `${b.label} ${b.count}`).join(", "),
          )}
          testID="summary"
          style={{ gap: 2, paddingBottom: 14, borderBottomWidth: hairline, borderBottomColor: colors.text }}
        >
          <Text variant="label">{s.present}</Text>
          <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: space.md }}>
            <Text variant="kpi" style={BIG_KPI}>{`${summary.pct}%`}</Text>
            <Text variant="rowTitle" tone="secondary">
              {s.summary(summary.present, summary.total)}
            </Text>
          </View>
          <Text variant="caption" tone="secondary" testID="breakdown">
            {summary.byStatus.map((b) => `${b.label} ${b.count}`).join(" · ")}
          </Text>
        </View>
      ) : null}

      {state.status === "ready" ? (
        <View>
          <SectionCount title={s.records} meta={s.logged(rows.length)} tight />
          <Bleed>
            <ListGroup inset={false}>
              {rows.length === 0 ? <EmptyState testID="empty" card={false} icon={CalendarCheck} title={s.emptyTitle} body={s.emptyBody} /> : null}
              {rows.map((r) => (
                <AttendanceRow key={r.id} record={r} />
              ))}
            </ListGroup>
          </Bleed>
        </View>
      ) : null}
    </LargeTitleScrollView>
  );
}

function AttendanceRow({ record: r }: { record: AttendanceRecord }) {
  const status = attendanceStatus(r.status);
  const title = r.events?.title ?? s.eventRemoved;
  const block = dayAndMonth(r.events?.start_date ?? null);
  const time = formatTime(r.checked_in_at);
  // Line two: the check-in time when there is one, else where it was (as the web).
  const line = time ? s.checkedIn(time) : (r.events?.location ?? s.locationTbc);
  return (
    <GroupRow
      lead={<DateBlock day={block?.day ?? "—"} mon={block?.mon ?? ""} />}
      trail={<StatusTag label={status.label} tone={status.tone} testID={`status-${r.status}`} />}
      accessibilityLabel={s.rowA11y(title, formatDate(r.events?.start_date ?? null) ?? "", status.label, line)}
      testID={`attendance-${r.id}`}
    >
      <Text variant="rowTitle">{title}</Text>
      <Text variant="caption" tone="secondary">
        {line}
      </Text>
    </GroupRow>
  );
}
