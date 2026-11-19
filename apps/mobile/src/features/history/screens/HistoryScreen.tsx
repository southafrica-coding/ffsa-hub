import { useRouter } from "expo-router";
import { History as HistoryIcon } from "lucide-react-native";
import { useCallback, useState } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { EmptyState, LargeTitleScrollView, ListGroup, SkeletonList, Text } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
// The pieces My Schools and My History share until the kit has them.
import { Bleed, Freshness, GroupRow, LoadError, SectionCount } from "@/features/schools/components/parts";
import { openWebPage } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { RecordSheet } from "../components/RecordSheet";
import { loadErrorMessage, loadHistory } from "../data";
import { recordA11yLabel, toSections, totalRecords, type HistoryRecord } from "../logic";
import { strings } from "../strings";
import type { History } from "../types";

const s = strings.list;

// My History (frames 9.1, 9.4): records on file from past applications,
// schools, payments and documents (the website's /my-history). Read-only,
// open to every signed-in person; tapping a row opens the full record in a
// sheet. No yellow band: nothing here asks anything of the person.
export default function HistoryScreen() {
  const router = useRouter();
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
    <>
      <LargeTitleScrollView
        eyebrow={total === null ? s.context : `${s.context} · ${s.records(total)}`}
        title={s.title}
        subtitle={s.intro}
        // My History is reached from Home (it isn't a tab), so it goes back to Home.
        back={{ label: strings.common.home, onPress: () => router.navigate("/") }}
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        {state.status === "loading" ? (
          <Bleed>
            <SkeletonList label={s.loading} count={4} inset={false} />
          </Bleed>
        ) : null}
        {state.status === "error" ? (
          <Bleed>
            <LoadError title={s.errorTitle} message={state.message} onRetry={retry} />
          </Bleed>
        ) : null}
        <Freshness state={state} onRetry={retry} />

        {data && total === 0 ? (
          <Bleed>
            <ListGroup inset={false}>
              <EmptyState testID="empty" card={false} icon={HistoryIcon} title={s.emptyTitle} body={s.emptyBody} />
            </ListGroup>
          </Bleed>
        ) : null}

        {sections.length > 0 ? (
          <View>
            {sections.map((section, i) => (
              <View key={section.kind} testID={`section-${section.kind}`}>
                <SectionCount title={section.title} meta={String(section.records.length)} tight={i === 0} />
                <Bleed>
                  <ListGroup inset={false}>
                    {section.records.map((r) => (
                      <RecordRow key={r.key} record={r} onPress={() => setOpen(r)} />
                    ))}
                  </ListGroup>
                </Bleed>
              </View>
            ))}
          </View>
        ) : null}
      </LargeTitleScrollView>

      <RecordSheet record={open} onClose={() => setOpen(null)} onOpenFile={(url) => void openWebPage(url, colors)} />
    </>
  );
}

/**
 * Title and subtitle, with the labelled date on the right. A date range
 * (Training attended) is too wide for that, so it sits underneath; any date
 * wraps under at large text sizes.
 */
function RecordRow({ record: r, onPress }: { record: HistoryRecord; onPress: () => void }) {
  const below = r.kind === "enrollments";
  return (
    <GroupRow onPress={onPress} accessibilityLabel={recordA11yLabel(r)} accessibilityHint={s.rowHint} testID={`record-${r.key}`}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.md, rowGap: space.xs }}>
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: below ? "100%" : 150, gap: 2 }}>
          <Text variant="rowTitle" numberOfLines={2}>
            {r.title}
          </Text>
          {r.subtitle ? (
            <Text variant="caption" tone="secondary" numberOfLines={2}>
              {r.subtitle}
            </Text>
          ) : null}
        </View>
        {r.date ? (
          <View style={below ? { flexDirection: "row", flexWrap: "wrap", columnGap: 6 } : { alignItems: "flex-end" }}>
            <Text variant="label">{r.dateLabel}</Text>
            <Text variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
              {r.date}
            </Text>
          </View>
        ) : null}
      </View>
    </GroupRow>
  );
}
