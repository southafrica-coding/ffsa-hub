import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Masthead, Screen, Text } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { EmptyState, ErrorState, Row, SectionBar, Skeleton, StaleNote } from "@/features/finance/components/ui";
import { useCachedLoad, type LoadState } from "@/features/finance/use-cached-load";
import { openWebPage } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { RecordSheet } from "../components/RecordSheet";
import { loadErrorMessage, loadHistory } from "../data";
import { recordA11yLabel, toSections, totalRecords, type HistoryRecord } from "../logic";
import { strings } from "../strings";
import type { History } from "../types";

const s = strings.list;

// My History: records on file from past applications, schools, payments and
// documents (the website's /my-history). Read-only, open to every signed-in
// person; tapping a row opens the full record in a sheet. No yellow band:
// nothing here asks anything of the person.
export default function HistoryScreen() {
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const [open, setOpen] = useState<HistoryRecord | null>(null);

  const load = useCallback(() => (userId ? loadHistory(userId) : Promise.reject(new Error("signed out"))), [userId]);
  const { state, refreshing, refresh, retry } = useCachedLoad<History>({
    userId,
    cacheName: "history.list",
    load,
    errorMessage: loadErrorMessage,
  });

  const data = state.status === "ready" ? state.data : null;
  const total = data ? totalRecords(data) : null;
  const sections = data ? toSections(data) : [];

  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        <Masthead context={total === null ? s.context : `${s.context} · ${s.records(total)}`} title={s.title} />
        <Text tone="secondary">{s.intro}</Text>

        {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
        {state.status === "error" ? <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} /> : null}
        <Freshness state={state} onRetry={retry} />

        {data && total === 0 ? <EmptyState title={s.emptyTitle} body={s.emptyBody} /> : null}

        {sections.map((section) => (
          <View key={section.kind} testID={`section-${section.kind}`}>
            <SectionBar title={section.title} meta={String(section.records.length)} />
            {section.records.map((r) => (
              <RecordRow key={r.key} record={r} onPress={() => setOpen(r)} />
            ))}
          </View>
        ))}
      </ScrollView>

      <RecordSheet record={open} onClose={() => setOpen(null)} onOpenFile={(url) => void openWebPage(url, colors)} />
    </Screen>
  );
}

/** Two lines closed (title, subtitle), the date on the right; it wraps under at large text sizes. */
function RecordRow({ record: r, onPress }: { record: HistoryRecord; onPress: () => void }) {
  return (
    <Row onPress={onPress} accessibilityLabel={recordA11yLabel(r)} accessibilityHint={s.rowHint} testID={`record-${r.key}`}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", columnGap: 12, rowGap: 4 }}>
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180, gap: 4 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {r.title}
          </Text>
          {r.subtitle ? (
            <Text variant="caption" tone="secondary" numberOfLines={2}>
              {r.subtitle}
            </Text>
          ) : null}
        </View>
        {r.date ? (
          <View style={{ gap: 2 }}>
            <Text variant="monoLabel" tone="secondary">
              {r.dateLabel}
            </Text>
            <Text variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
              {r.date}
            </Text>
          </View>
        ) : null}
      </View>
    </Row>
  );
}

/** When what's on screen is the copy saved on this phone: "Last updated …", or the stale note with a retry. */
function Freshness({ state, onRetry }: { state: LoadState<History>; onRetry: () => void }) {
  if (state.status !== "ready" || state.staleSince === null) return null;
  const when = formatSavedAt(state.staleSince);
  if (state.refreshError) return <StaleNote message={strings.common.refreshFailed(when)} onRetry={onRetry} />;
  return (
    <Text variant="caption" tone="secondary" testID="last-updated">
      {strings.common.lastUpdated(when)}
    </Text>
  );
}
