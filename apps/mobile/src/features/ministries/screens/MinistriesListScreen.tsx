import { useRouter } from "expo-router";
import { Plus, UsersRound } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Masthead, Screen, Text } from "@/components";
import { ErrorState, Row, SectionBar, Skeleton } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { Chevron, Freshness, StatusTag } from "@/features/schools/components/ui";
import { ListRow, StateMessage, openWebPage } from "@/features/shell";
import { apiFetch } from "@/lib/api-client";
import { refreshControlColors } from "@/theme/styles";
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
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        <Masthead context={data ? s.contextCount(data.ministries.length, data.scope === "led") : s.context} title={s.title} />

        {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
        {forbidden ? (
          <StateMessage testID="forbidden" icon={UsersRound} title={strings.gate.title} body={strings.common.forbidden} />
        ) : state.status === "error" ? (
          <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} />
        ) : null}
        <Freshness state={state} onRetry={retry} />

        {data ? (
          <View>
            {data.ministries.length === 0 ? (
              <StateMessage testID="empty" icon={UsersRound} title={s.emptyTitle} body={s.emptyBody} />
            ) : (
              sections.map((section) => (
                <View key={section.type}>
                  {showHeadings ? <SectionBar title={section.label} meta={String(section.items.length)} /> : null}
                  {section.items.map((m) => (
                    <MinistryRow key={m.id} ministry={m} onPress={() => router.push({ pathname: "/ministries/[id]", params: { id: m.id } })} />
                  ))}
                </View>
              ))
            )}
            {data.canCreate ? (
              <ListRow
                icon={Plus}
                title={s.create}
                subtitle={s.createSub}
                trailing="web"
                accessibilityHint={s.createHint}
                onPress={() => void openWebPage("/ministry", colors)}
                testID="create-ministry"
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function MinistryRow({ ministry: m, onPress }: { ministry: MinistryListItem; onPress: () => void }) {
  const people = s.people(m.peopleCount);
  return (
    <Row onPress={onPress} accessibilityLabel={s.rowA11y(m.name, people, !m.isActive, m.description)} accessibilityHint={s.rowHint} testID={`ministry-${m.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title">{m.name}</Text>
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {m.description ? `${people} · ${m.description}` : people}
          </Text>
          {!m.isActive ? <StatusTag label={s.retired} tone="default" testID={`retired-${m.id}`} /> : null}
        </View>
        <Chevron />
      </View>
    </Row>
  );
}
