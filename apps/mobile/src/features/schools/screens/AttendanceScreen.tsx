import { CalendarCheck } from "lucide-react-native";
import { useCallback } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Masthead, Screen, Text } from "@/components";
import { ErrorState, Row, SectionBar, Skeleton } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { StateMessage } from "@/features/shell";
import { hairline } from "@/theme/tokens";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { DateBlock, Freshness, StatusTag } from "../components/ui";
import { loadAttendance, loadErrorMessage } from "../data";
import { attendanceStatus, dayAndMonth, formatDate, formatTime, summariseAttendance } from "../logic";
import { strings } from "../strings";
import type { AttendanceRecord } from "../types";

const s = strings.attendance;

// My Attendance: the share of sessions the person was present at (the
// screen's one big number, as on the web), a count per status in words, then
// every record. Read-only; staff take attendance on the website.
export default function AttendanceScreen() {
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

  const header = (
    <View style={{ gap: 16, paddingBottom: 0 }}>
      <Masthead context={s.context} title={s.title} />
      {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
      {state.status === "error" ? <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} /> : null}
      <Freshness state={state} onRetry={retry} />

      {summary.pct !== null ? (
        <View
          accessible
          accessibilityLabel={strings.a11y.withBreakdown(
            s.summaryA11y(summary.pct, summary.present, summary.total),
            summary.byStatus.map((b) => `${b.label} ${b.count}`).join(", "),
          )}
          testID="summary"
          style={{ gap: 6, paddingBottom: 14, borderBottomWidth: hairline, borderBottomColor: colors.text }}
        >
          <Text variant="label" tone="secondary">
            {s.present}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
            <Text variant="numeral">{`${summary.pct}%`}</Text>
            <Text variant="bodyStrong" tone="secondary">
              {s.summary(summary.present, summary.total)}
            </Text>
          </View>
          <Text variant="caption" tone="secondary" testID="breakdown">
            {summary.byStatus.map((b) => `${b.label} ${b.count}`).join(" · ")}
          </Text>
        </View>
      ) : null}

      {state.status === "ready" ? <SectionBar title={s.records} meta={s.logged(rows.length)} /> : null}
    </View>
  );

  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <AttendanceRow record={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={state.status === "ready" ? <StateMessage testID="empty" icon={CalendarCheck} title={s.emptyTitle} body={s.emptyBody} /> : undefined}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      />
    </Screen>
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
    <Row accessibilityLabel={s.rowA11y(title, formatDate(r.events?.start_date ?? null) ?? "", status.label, line)} testID={`attendance-${r.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <DateBlock day={block?.day ?? "—"} mon={block?.mon ?? ""} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" tone="secondary">
            {line}
          </Text>
        </View>
        <StatusTag label={status.label} tone={status.tone} testID={`status-${r.status}`} />
      </View>
    </Row>
  );
}
