import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { type BackAction, Banner, Bleed, EmptyState, GroupRow, LargeTitleScrollView, ListGroup, ListRow, LoadError, PushedPage, SectionTitle, SkeletonList, Text } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { timeAgo } from "@/features/home/feed-logic";
import { openWebPage } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { hairline, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { okrsApi } from "../client";
import { Bar, CycleSwitcher, Figure, FigureStrip, StatusTag, Freshness } from "../components/ui";
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

  const back: BackAction = { label: strings.wall.title, onPress: () => router.back() };

  if (state.status === "loading") {
    return (
      <PushedPage back={back}>
        <Bleed>
          <SkeletonList label={s.loading} count={5} inset={false} />
        </Bleed>
      </PushedPage>
    );
  }
  if (state.status === "error") {
    return (
      <PushedPage back={back}>
        <Bleed>
          {state.message === s.notFound ? (
            <EmptyState
              testID="not-found"
              title={s.notFoundTitle}
              body={s.notFound}
              actionLabel={strings.common.allGroups}
              onAction={() => router.navigate("/okrs")}
            />
          ) : (
            <LoadError title={s.errorTitle} message={state.message} onRetry={retry} />
          )}
        </Bleed>
      </PushedPage>
    );
  }

  const data = state.data;
  // Looked up from the latest data, so a saved check-in shows its new status.
  const open = findKeyResult(data.objectives, openKrId);

  return (
    <>
      <LargeTitleScrollView
        back={back}
        eyebrow={`${s.context(data.owner.kind === "team")} · ${data.cycle.name}`}
        title={data.owner.name}
        gap={0}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        {state.staleSince !== null ? (
          <Bleed style={{ marginBottom: space.md }}>
            <Freshness state={state} onRetry={retry} checkinsNote={data.canEdit} />
          </Bleed>
        ) : null}

        <Bleed>
          <CycleSwitcher cycles={data.cycles} active={data.cycle} onChange={(slug) => router.setParams({ cycle: slug })} />
        </Bleed>

        <View style={{ marginTop: space.lg }}>
          <FigureStrip four>
            <Figure label={s.kpiObjectives} value={data.totals.objectives} />
            <Figure label={s.kpiKeyResults} value={data.totals.keyResults} />
            <Figure label={s.kpiComplete} value={data.totals.complete} />
            <Figure label={s.kpiStuck} value={data.totals.stuck} tone={data.totals.stuck > 0 ? "danger" : "default"} testID="kpi-stuck" />
          </FigureStrip>
        </View>

        {/* Calm, not an alarm: who can change this, in a sentence. */}
        <Bleed style={{ marginTop: space.lg }}>
          <Banner tone="info" testID="access-note">
            {data.canEdit ? s.canEdit : data.readOnly === "closed" ? s.closed : s.readAccess}
          </Banner>
        </Bleed>

        {data.objectives.length === 0 ? (
          <Text tone="secondary" testID="empty" style={{ marginTop: space.lg }}>
            {data.canEdit ? s.emptyEditable : s.emptyReadOnly}
          </Text>
        ) : (
          data.objectives.map((o) => <ObjectiveBlock key={o.id} objective={o} canEdit={data.canEdit} onOpen={setOpenKrId} />)
        )}

        {data.canEdit ? (
          <Bleed style={{ marginTop: space.xl }}>
            <ListGroup inset={false}>
              <ListRow
                title={s.editOnWeb}
                trailing="web"
                accessibilityHint={s.editOnWebHint}
                onPress={() => void openWebPage(webPath(ownerId, data.cycle.slug), colors)}
                testID="edit-on-web"
              />
            </ListGroup>
          </Bleed>
        ) : null}
      </LargeTitleScrollView>

      {open ? (
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
    </>
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
      <SectionTitle title={`${o.position}. ${o.title}`} meta={s.keyResultsMeta(o.keyResults.length)} />
      {o.description || o.timeline || o.notes ? (
        <Bleed style={{ marginBottom: space.sm }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: hairline,
              borderColor: colors.rule,
              borderRadius: radius.card,
              paddingHorizontal: space.md,
              paddingVertical: 10,
              gap: space.xs,
            }}
          >
            {o.description ? <Text tone="secondary">{o.description}</Text> : null}
            {o.timeline ? <Text variant="label">{o.timeline}</Text> : null}
            {o.notes ? <Text>{o.notes}</Text> : null}
          </View>
        </Bleed>
      ) : null}
      {o.keyResults.length === 0 ? (
        <Text tone="secondary" style={{ paddingVertical: space.sm }}>
          {s.noKeyResults}
        </Text>
      ) : (
        <Bleed>
          <ListGroup inset={false}>
            {o.keyResults.map((kr) => (
              <KeyResultRow key={kr.id} kr={kr} canEdit={canEdit} onPress={() => onOpen(kr.id)} />
            ))}
          </ListGroup>
        </Bleed>
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
    <GroupRow onPress={onPress} accessibilityLabel={a11y} accessibilityHint={s.krHint(canEdit)} testID={`kr-${kr.id}`}>
      <Text>
        {kr.label ? <Text variant="label">{`${kr.label}  `}</Text> : null}
        {kr.description}
      </Text>
      <View style={{ marginTop: space.xs }}>
        <StatusTag status={kr.status} testID={`kr-status-${kr.id}`} />
      </View>
      {/* No ratio, no bar: prose key results get no track at all. */}
      {kr.progressPct !== null ? (
        <View style={{ gap: space.xs, marginTop: space.xs }}>
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
    </GroupRow>
  );
}
