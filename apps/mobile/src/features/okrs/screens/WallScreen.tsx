import { useRouter } from "expo-router";
import { Target } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { EmptyState, LargeTitleScrollView, ListGroup, ListRow, SkeletonList, Text, type BackAction } from "@/components";
import { Bleed, GroupRow, LoadError, SectionTitle } from "@/features/finance/components/parts";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { okrsApi } from "../client";
import { CycleSwitcher, Figure, FigureStrip, Freshness, StatusTag } from "../components/ui";
import { cacheName, loadErrorMessage, statusTally, webPath } from "../logic";
import { strings } from "../strings";
import type { OwnerSummary, Wall } from "../types";

const s = strings.wall;

// The OKR wall: every ministry's objectives for one cycle, as on the
// website's /okrs. Open to every signed-in person. The "not started" list
// only comes back from the server for people who can act on it (admin,
// leadership team, ministry leaders) and only on the current cycle. No
// yellow band: the web wall has no "needs you" signal, and we don't invent one.
export default function WallScreen({ cycle }: { cycle: string | null }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;

  const load = useCallback(() => okrsApi.loadWall(cycle), [cycle]);
  const { state, refreshing, refresh, retry } = useCachedLoad<Wall>({
    userId,
    cacheName: cacheName(null, cycle),
    load,
    errorMessage: loadErrorMessage,
  });

  const data = state.status === "ready" ? state.data : null;
  const active = data?.cycle ?? null;
  // OKRs is reached from Home (it isn't a tab), so the wall goes back to Home.
  const back: BackAction = { label: strings.common.home, onPress: () => router.navigate("/") };
  const openOwner = (o: OwnerSummary) =>
    router.push({ pathname: "/okrs/[ownerId]", params: active ? { ownerId: o.id, cycle: active.slug } : { ownerId: o.id } });

  return (
    <LargeTitleScrollView
      back={back}
      eyebrow={active ? `${s.context} · ${active.name}` : s.context}
      title={s.title}
      gap={0}
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
      {state.status === "ready" && state.staleSince !== null ? (
        <Bleed style={{ marginBottom: space.md }}>
          <Freshness state={state} onRetry={retry} checkinsNote />
        </Bleed>
      ) : null}

      {data && !active ? (
        <Bleed>
          <EmptyState testID="no-cycle" icon={Target} title={s.noCycleTitle} body={s.noCycleBody} />
        </Bleed>
      ) : null}

      {data && active ? (
        <>
          <Bleed>
            <CycleSwitcher cycles={data.cycles} active={active} onChange={(slug) => router.setParams({ cycle: slug })} />
          </Bleed>

          <View style={{ marginTop: space.lg }}>
            <FigureStrip>
              <Figure label={s.kpiStarted} value={data.totals.groupsStarted} foot={s.kpiStartedFoot(data.totals.groups)} testID="kpi-started" />
              <Figure label={s.kpiObjectives} value={data.totals.objectives} />
              <Figure
                label={s.kpiKeyResults}
                value={data.totals.keyResults}
                foot={s.kpiComplete(data.totals.complete)}
                // A completed/total ratio genuinely exists here, so a bar is honest.
                barPct={data.totals.keyResults > 0 ? (data.totals.complete / data.totals.keyResults) * 100 : undefined}
              />
              <Figure
                label={s.kpiStuck}
                value={data.totals.stuck}
                tone={data.totals.stuck > 0 ? "danger" : "default"}
                foot={data.totals.stuck > 0 ? s.kpiStuckSome : s.kpiStuckNone}
                testID="kpi-stuck"
              />
            </FigureStrip>
          </View>

          <Text tone="secondary" style={{ marginTop: space.lg }}>
            {s.intro(active.name)}
          </Text>

          {data.totals.groups === 0 ? (
            <Text tone="secondary" testID="no-groups" style={{ marginTop: space.lg }}>
              {s.noGroups}
            </Text>
          ) : data.sections.length === 0 ? (
            <Text tone="secondary" testID="nothing-yet" style={{ marginTop: space.lg }}>
              {s.nothingYet(active.name)}
            </Text>
          ) : (
            data.sections.map((section) => (
              <View key={section.type} testID={`section-${section.type}`}>
                {data.showHeadings ? (
                  <SectionTitle title={section.label} meta={s.sectionMeta(section.started.length, section.total)} />
                ) : section.started.length > 0 ? (
                  <SectionTitle title={s.groupsHeading} meta={String(section.started.length)} />
                ) : null}
                {section.started.length > 0 ? (
                  <Bleed>
                    <ListGroup inset={false}>
                      {section.started.map((o) => (
                        <OwnerRow key={o.id} owner={o} onPress={() => openOwner(o)} />
                      ))}
                    </ListGroup>
                  </Bleed>
                ) : null}
                {/* Inside its section, so a leader sees which kind of ministry hasn't started. */}
                {section.notStarted.length > 0 ? (
                  <View testID={`not-started-${section.type}`}>
                    <SectionTitle title={s.notStarted} meta={String(section.notStarted.length)} tight={section.started.length > 0} />
                    <Bleed>
                      <ListGroup inset={false}>
                        {section.notStarted.map((o) => (
                          <OwnerRow key={o.id} owner={o} onPress={() => openOwner(o)} />
                        ))}
                      </ListGroup>
                    </Bleed>
                  </View>
                ) : null}
              </View>
            ))
          )}

          <Bleed style={{ marginTop: space.xl }}>
            <ListGroup inset={false}>
              {data.canManageCycles ? (
                <ListRow
                  title={strings.cycle.manage}
                  trailing="web"
                  onPress={() => void openWebPage("/okrs/cycles", colors)}
                  accessibilityHint={strings.cycle.manageHint}
                  testID="manage-cycles"
                />
              ) : null}
              <ListRow title={s.openWeb} trailing="web" onPress={() => void openWebPage(webPath(null, active.slug), colors)} testID="open-web" />
            </ListGroup>
          </Bleed>
        </>
      ) : null}
    </LargeTitleScrollView>
  );
}

/**
 * One group's row. Started and not-started share a shape so the list keeps
 * one rhythm; the empty one is quieter but still opens the group's page.
 */
function OwnerRow({ owner, onPress }: { owner: OwnerSummary; onPress: () => void }) {
  const empty = owner.objectives === 0;
  const tally = statusTally(owner.byStatus);
  const counts = empty ? s.noOkrsYet : s.counts(owner.objectives, owner.keyResults);
  const a11y = [owner.name, owner.retired ? s.retired : null, counts, ...tally.map((t) => t.text)].filter(Boolean).join(". ");
  return (
    <GroupRow onPress={onPress} accessibilityLabel={a11y} accessibilityHint={s.ownerHint} testID={`owner-${owner.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: space.sm }}>
        <Text variant="rowTitle" tone={empty ? "secondary" : "default"} style={{ flexShrink: 1 }}>
          {owner.name}
        </Text>
        {owner.retired ? <Text variant="label">{s.retired}</Text> : null}
      </View>
      <Text variant="caption" tone="secondary">
        {counts}
      </Text>
      {tally.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.xs }}>
          {tally.map((t) => (
            <StatusTag key={t.status} status={t.status} text={t.text} />
          ))}
        </View>
      ) : null}
    </GroupRow>
  );
}
