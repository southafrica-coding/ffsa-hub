import { useRouter } from "expo-router";
import { useCallback } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { Banner, Masthead, Screen, Text } from "@/components";
import { useSession } from "@/auth/session-provider";
import { useMe } from "@/features/shell";
import { supabase } from "@/lib/supabase";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { isFinanceStaff } from "../access";
import { userMessage } from "../api";
import { formatSavedAt } from "../cache";
import { BudgetBar, EmptyState, ErrorState, Row, SectionBar, Skeleton, StaleNote, Tag } from "../components/ui";
import { loadHome, type HomeData, type HomeTeam, type ReadClient } from "../data";
import { budgetFigures, moneyLabel } from "../money";
import { useOutbox } from "../outbox/provider";
import type { OutboxItem } from "../outbox/state";
import { strings } from "../strings";
import { useCachedLoad } from "../use-cached-load";

const db = supabase as unknown as ReadClient;

export function dateRange(start: string | null, end: string | null) {
  const parts = [start, end].filter(Boolean) as string[];
  return parts.length ? parts.map((d) => d.slice(0, 10)).join(" – ") : strings.home.datesTbc;
}

export default function FinanceHomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const { me } = useMe();
  const { items, online } = useOutbox();

  const load = useCallback(() => loadHome(db), []);
  const { state, refreshing, refresh, retry } = useCachedLoad<HomeData>({
    userId,
    cacheName: "home",
    load,
    errorMessage: userMessage,
  });

  const mine = items.filter((i) => i.userId === userId);
  const failed = mine.filter((i) => i.status === "failed");

  return (
    <Screen scroll={false} edges={["top"]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        <Masthead context={strings.home.context} title={strings.home.title} />

        {!online ? <Banner tone="info">{strings.outbox.offline}</Banner> : null}

        {/* The screen's one yellow band: only when something on this phone needs the person. */}
        {failed.length > 0 ? (
          <Banner tone="needsYou" title={strings.team.needsYouTitle} testID="needs-you">
            {`${failed.length} ${failed.length === 1 ? "item" : "items"} couldn't be sent. Open the team to retry or remove ${failed.length === 1 ? "it" : "them"}.`}
          </Banner>
        ) : null}

        {state.status === "loading" ? <Skeleton label={strings.home.loading} /> : null}

        {state.status === "error" ? <ErrorState title={strings.home.errorTitle} message={state.message} onRetry={retry} /> : null}

        {state.status === "ready" && state.refreshError && state.staleSince !== null ? (
          <StaleNote message={strings.common.refreshFailed(formatSavedAt(state.staleSince))} onRetry={retry} />
        ) : null}

        {state.status === "ready" && state.data.teams.length === 0 ? (
          <EmptyState
            title={strings.home.emptyTitle}
            body={strings.home.emptyBody}
            extra={isFinanceStaff(me) ? strings.home.emptyStaff : null}
          />
        ) : null}

        {state.status === "ready" && state.data.teams.length > 0 ? (
          <View>
            <SectionBar
              title={strings.home.teamsSection}
              meta={`${state.data.teams.length} ${state.data.teams.length === 1 ? "team" : "teams"}`}
            />
            {state.data.teams.map((t) => (
              <TeamRow
                key={t.membership_id}
                team={t}
                pending={mine.filter((i) => i.teamId === t.team_id)}
                onPress={() => router.push({ pathname: "/finance/[teamId]", params: { teamId: t.team_id } })}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function TeamRow({ team, pending, onPress }: { team: HomeTeam; pending: OutboxItem[]; onPress: () => void }) {
  const role = strings.roles[team.role] ?? team.role;
  const status = strings.status[team.status] ?? team.status;
  const line2 = [team.program_name, team.location ?? strings.home.locationTbc, role].filter(Boolean).join(" · ");
  const figures = team.money ? budgetFigures(team.money.budget, team.money.spent) : null;
  const pendingText = pending.length ? `${pending.length} saved on this phone, not yet sent` : null;
  // Budgets and spending are stored in rand; a team abroad also spends locally.
  const localNote = team.money && team.money.currency !== "ZAR" ? `Figures in rand · spends in ${team.money.currency}` : null;
  const spokenMoney = figures
    ? `${strings.team.spent} ${moneyLabel(figures.spent, "ZAR", { cents: false })} of ${moneyLabel(figures.total, "ZAR", { cents: false })}, ${strings.team.remaining} ${moneyLabel(figures.remaining, "ZAR", { cents: false })}`
    : strings.home.noMoney;

  return (
    <Row
      onPress={onPress}
      accessibilityLabel={[team.team_name, status, line2, spokenMoney, localNote, pendingText].filter(Boolean).join(". ")}
      accessibilityHint="Opens the team's budget and expenses"
      testID={`team-row-${team.team_id}`}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title" numberOfLines={2}>
            {team.team_name}
          </Text>
          <Text variant="monoLabel" tone="secondary">
            {line2}
          </Text>
        </View>
        <Tag>{status}</Tag>
      </View>
      {figures && team.money ? (
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <BudgetBar figures={figures} currency="ZAR" compact />
        </View>
      ) : (
        <Text variant="caption" tone="secondary">
          {strings.home.noMoney}
        </Text>
      )}
      {localNote ? (
        <Text variant="caption" tone="secondary">
          {localNote}
        </Text>
      ) : null}
      {pendingText ? (
        <Text variant="caption" tone="attention">
          {pendingText}
        </Text>
      ) : null}
    </Row>
  );
}
