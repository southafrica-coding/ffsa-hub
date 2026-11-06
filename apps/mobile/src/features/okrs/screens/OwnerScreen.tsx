import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Masthead, Screen, Text } from "@/components";
import { ErrorState, Row, SectionBar, Skeleton } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { timeAgo } from "@/features/home/feed-logic";
import { ListRow, StateMessage, openWebPage } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { okrsApi } from "../client";
import { Bar, CycleSwitcher, Freshness, Kpi, KpiStrip, StatusTag } from "../components/ui";
import { cacheName, isNotFound, loadErrorMessage, statusLabel, webPath } from "../logic";
import { strings } from "../strings";
import type { KeyResult, Objective, OwnerPage } from "../types";

import { KeyResultSheet } from "./KeyResultSheet";

const s = strings.owner;

const errorMessage = (err: unknown) => (isNotFound(err) ? s.notFound : loadErrorMessage(err));

// One group's OKRs (a staff ministry or an OKR-only team) for one cycle, as
// on the website's /okrs/[ownerId]. Everyone signed in can read; the
// server's canEdit (leads this ministry or admin, AND the cycle is current)
// decides whether the key-result sheet offers a check-in. Writing objectives
// and key results stays on the website.
export default function OwnerScreen({ ownerId, cycle }: { ownerId: string; cycle: string | null }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const [openKrId, setOpenKrId] = useState<string | null>(null);

  const load = useCallback(() => okrsApi.loadOwner(ownerId, cycle), [ownerId, cycle]);
  const { state, refreshing, refresh, retry } = useCachedLoad<OwnerPage>({
    userId,
    cacheName: cacheName(ownerId, cycle),
    load,
    errorMessage,
  });

  const data = state.status === "ready" ? state.data : null;
  // Looked up from the latest data, so a saved check-in shows its new status.
  const open = data ? findKeyResult(data.objectives, openKrId) : null;

  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
        {state.status === "error" ? (
          state.message === s.notFound ? (
            <StateMessage testID="not-found" title={s.notFoundTitle} body={s.notFound} actionLabel={strings.common.allGroups} onAction={() => router.navigate("/okrs")} />
          ) : (
            <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} />
          )
        ) : null}

        {data ? (
          <>
            <Masthead context={`${s.context(data.owner.kind === "team")} · ${data.cycle.name}`} title={data.owner.name} />
            <Freshness state={state} onRetry={retry} />

            <CycleSwitcher cycles={data.cycles} active={data.cycle} onChange={(slug) => router.setParams({ cycle: slug })} />

            <KpiStrip>
              <Kpi label={s.kpiObjectives} value={data.totals.objectives} />
              <Kpi label={s.kpiKeyResults} value={data.totals.keyResults} />
              <Kpi label={s.kpiComplete} value={data.totals.complete} />
              <Kpi label={s.kpiStuck} value={data.totals.stuck} tone={data.totals.stuck > 0 ? "danger" : "default"} testID="kpi-stuck" />
            </KpiStrip>

            {/* Calm, not an alarm: who can change this, in a sentence. */}
            <Banner tone="info" testID="access-note">
              {data.canEdit ? s.canEdit : data.readOnly === "closed" ? s.closed : s.readAccess}
            </Banner>

            {data.objectives.length === 0 ? (
              <Text tone="secondary" testID="empty">
                {data.canEdit ? s.emptyEditable : s.emptyReadOnly}
              </Text>
            ) : (
              data.objectives.map((o) => <ObjectiveBlock key={o.id} objective={o} canEdit={data.canEdit} onOpen={setOpenKrId} />)
            )}

            {data.canEdit ? (
              <ListRow
                title={s.editOnWeb}
                trailing="web"
                accessibilityHint={s.editOnWebHint}
                onPress={() => void openWebPage(webPath(ownerId, data.cycle.slug), colors)}
                testID="edit-on-web"
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {data && open ? (
        <KeyResultSheet
          key={open.kr.id}
          keyResult={open.kr}
          objectiveTitle={open.objective.title}
          canEdit={data.canEdit}
          readOnly={data.readOnly}
          onClose={() => setOpenKrId(null)}
          onSaved={refresh}
          onEditOnWeb={() => void openWebPage(webPath(ownerId, data.cycle.slug), colors)}
        />
      ) : null}
    </Screen>
  );
}

function findKeyResult(objectives: Objective[], id: string | null): { kr: KeyResult; objective: Objective } | null {
  if (!id) return null;
  for (const objective of objectives) {
    const kr = objective.keyResults.find((k) => k.id === id);
    if (kr) return { kr, objective };
  }
  return null;
}

function ObjectiveBlock({ objective: o, canEdit, onOpen }: { objective: Objective; canEdit: boolean; onOpen: (id: string) => void }) {
  const { colors } = useTheme();
  return (
    <View testID={`objective-${o.id}`}>
      <SectionBar title={`${o.position}. ${o.title}`} meta={s.keyResultsMeta(o.keyResults.length)} />
      {o.description || o.timeline || o.notes ? (
        <View style={{ backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 10, gap: 6 }}>
          {o.description ? <Text tone="secondary">{o.description}</Text> : null}
          {o.timeline ? (
            <Text variant="label" tone="secondary">
              {o.timeline}
            </Text>
          ) : null}
          {o.notes ? <Text>{o.notes}</Text> : null}
        </View>
      ) : null}
      {o.keyResults.length === 0 ? (
        <Text tone="secondary" style={{ paddingVertical: 12 }}>
          {s.noKeyResults}
        </Text>
      ) : (
        o.keyResults.map((kr) => <KeyResultRow key={kr.id} kr={kr} canEdit={canEdit} onPress={() => onOpen(kr.id)} />)
      )}
    </View>
  );
}

function KeyResultRow({ kr, canEdit, onPress }: { kr: KeyResult; canEdit: boolean; onPress: () => void }) {
  // Recency is the point of the row: six months untouched shouldn't look like yesterday.
  const ago = kr.lastCheckinAt ? timeAgo(kr.lastCheckinAt) : null;
  const meta = [kr.timeline, ago ? s.updated(ago) : s.neverUpdated, kr.notes ? s.hasNotes : null].filter(Boolean).join(" · ");
  const a11y = [
    kr.label,
    kr.description,
    statusLabel(kr.status),
    kr.caption && kr.progressPct !== null ? `${kr.caption}, ${s.progress(kr.progressPct)}` : null,
    meta,
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <Row onPress={onPress} accessibilityLabel={a11y} accessibilityHint={s.krHint(canEdit)} testID={`kr-${kr.id}`}>
      <Text>
        {kr.label ? (
          <Text variant="label" tone="secondary">
            {`${kr.label}  `}
          </Text>
        ) : null}
        {kr.description}
      </Text>
      <StatusTag status={kr.status} testID={`kr-status-${kr.id}`} />
      {/* No ratio, no bar: prose key results get no track at all. */}
      {kr.progressPct !== null ? (
        <View style={{ gap: 4 }}>
          <Bar pct={kr.progressPct} testID={`kr-bar-${kr.id}`} />
          {kr.caption ? (
            <Text variant="caption" tone="secondary">
              {kr.caption}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text variant="caption" tone="secondary">
        {meta}
      </Text>
    </Row>
  );
}
