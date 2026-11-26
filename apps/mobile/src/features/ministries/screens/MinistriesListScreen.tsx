import { useRouter } from "expo-router";
import { Plus, UsersRound } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Bleed, EmptyState, FadeIn, Freshness, GroupRow, LargeTitleScrollView, ListGroup, ListRow, LoadError, SectionTitle, SkeletonList, StatusChip, Text } from "@/components";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { getMinistries, loadErrorMessage, type MinistryList, type MinistryListItem } from "../api";
import { listSections } from "../logic";
import { strings } from "../strings";

const s = strings.list;

// Ministries: the ministries this person can open on the website (all of
// them for admins and Leadership Team, the ones they lead otherwise), split
// into Main / Part-time once both exist. Each opens its team. Read-only; an
// admin's "Create a ministry" opens the website. No yellow band here: the
// web list has none and nothing on it needs anyone.
export default function MinistriesListScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;

  const load = useCallback(() => getMinistries(apiFetch), []);
  const { state, refreshing, refresh, retry } = useCachedLoad<MinistryList>({
    userId,
    cacheName: "ministries.list",
    load,
    errorMessage: loadErrorMessage,
  });

  const data = state.status === "ready" ? state.data : null;
  const forbidden = state.status === "error" && state.message === strings.common.forbidden;
  const { sections, showHeadings } = listSections(data?.ministries ?? []);

  return (
    <LargeTitleScrollView
      // Ministries is reached from Home (it isn't a tab), so the list goes back to Home.
      back={{ label: strings.common.home, onPress: () => router.navigate("/") }}
      eyebrow={data ? s.contextCount(data.ministries.length, data.scope === "led") : s.context}
      title={s.title}
      gap={0}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
    >
      <Bleed>
        {state.status === "loading" ? <SkeletonList label={s.loading} count={5} inset={false} /> : null}
        {forbidden ? (
          <EmptyState testID="forbidden" icon={UsersRound} title={strings.gate.title} body={strings.common.forbidden} />
        ) : state.status === "error" ? (
          <LoadError title={s.errorTitle} message={state.message} onRetry={retry} />
        ) : null}
        {state.status === "ready" && state.staleSince !== null ? (
          <View style={{ marginBottom: space.md }}>
            <Freshness state={state} onRetry={retry} />
          </View>
        ) : null}
        {data && data.ministries.length === 0 ? <EmptyState testID="empty" icon={UsersRound} title={s.emptyTitle} body={s.emptyBody} /> : null}
      </Bleed>

      {data && sections.length > 0 ? (
        <FadeIn>
          {sections.map((section, i) => (
            <View key={section.type}>
              {showHeadings ? <SectionTitle title={section.label} meta={section.items.length} tight={i === 0} /> : null}
              <Bleed>
                <ListGroup inset={false}>
                  {section.items.map((m) => (
                    <MinistryRow key={m.id} ministry={m} onPress={() => router.push({ pathname: "/ministries/[id]", params: { id: m.id } })} />
                  ))}
                </ListGroup>
              </Bleed>
            </View>
          ))}
        </FadeIn>
      ) : null}

      {data?.canCreate ? (
        <Bleed style={{ marginTop: space.lg }}>
          <ListGroup inset={false}>
            <ListRow
              icon={Plus}
              title={s.create}
              subtitle={s.createSub}
              trailing="web"
              accessibilityHint={s.createHint}
              onPress={() => void openWebPage("/ministry", colors)}
              testID="create-ministry"
            />
          </ListGroup>
        </Bleed>
      ) : null}
    </LargeTitleScrollView>
  );
}

function MinistryRow({ ministry: m, onPress }: { ministry: MinistryListItem; onPress: () => void }) {
  const people = s.people(m.peopleCount);
  return (
    <GroupRow onPress={onPress} accessibilityLabel={s.rowA11y(m.name, people, !m.isActive, m.description)} accessibilityHint={s.rowHint} testID={`ministry-${m.id}`}>
      <Text variant="rowTitle">{m.name}</Text>
      <Text variant="caption" tone="secondary" numberOfLines={2}>
        {m.description ? `${people} · ${m.description}` : people}
      </Text>
      {!m.isActive ? (
        <View style={{ marginTop: space.xs }}>
          <StatusChip label={s.retired} variant="quiet" icon={null} testID={`retired-${m.id}`} />
        </View>
      ) : null}
    </GroupRow>
  );
}
