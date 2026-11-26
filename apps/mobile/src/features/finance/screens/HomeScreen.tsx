import { useRouter } from "expo-router";
import { Clock, ShieldCheck, Wallet } from "lucide-react-native";
import { useCallback } from "react";
import { RefreshControl, View } from "react-native";

import { Banner, Bleed, EmptyState, FadeIn, GroupRow, InfoRow, LargeTitleScrollView, ListGroup, LoadError, NeedsYouBand, SectionTitle, SkeletonList, StaleNote, StatusChip, StatusLine, Text, useLargeText } from "@/components";
import { useSession } from "@/auth/session-provider";
import { useMe } from "@/features/shell";
import { supabase } from "@/lib/supabase";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { isFinanceStaff } from "../access";
import { userMessage } from "../api";
import { formatSavedAt } from "../cache";
import { BudgetBar } from "../components/parts";
import { loadHome, type HomeData, type HomeTeam, type ReadClient } from "../data";
import { budgetFigures, moneyLabel } from "../money";
import { useOutbox } from "../outbox/provider";
import type { OutboxItem } from "../outbox/state";
import { strings } from "../strings";
import { useCachedLoad } from "../use-cached-load";

const db = supabase as unknown as ReadClient;
const s = strings.home;

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
  const teams = state.status === "ready" ? state.data.teams : null;

  return (
    <LargeTitleScrollView
      eyebrow={s.context}
      title={s.title}
      gap={0}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
    >
      <Bleed style={{ gap: space.md }}>
        {!online ? <Banner tone="offline">{strings.outbox.offline}</Banner> : null}

        {/* The screen's one yellow band: only when something on this phone needs the person. */}
        {failed.length > 0 ? <NeedsYouBand eyebrow={strings.team.needsYouTitle} text={s.couldntSend(failed.length)} testID="needs-you" /> : null}

        {state.status === "loading" ? <SkeletonList label={s.loading} inset={false} /> : null}

        {state.status === "error" ? <LoadError title={s.errorTitle} message={state.message} onRetry={retry} /> : null}

        {state.status === "ready" && state.refreshError && state.staleSince !== null ? (
          <StaleNote message={strings.common.refreshFailed(formatSavedAt(state.staleSince))} onRetry={retry} />
        ) : null}

        {teams && teams.length === 0 ? <EmptyState icon={Wallet} title={s.emptyTitle} body={s.emptyBody} testID="empty-state" /> : null}
      </Bleed>

      {teams && teams.length === 0 && isFinanceStaff(me) ? (
        <Text variant="note" style={{ marginTop: space.lg }}>
          {s.emptyStaff}
        </Text>
      ) : null}

      {teams && teams.length > 0 ? (
        <FadeIn>
          <SectionTitle title={s.teamsSection} meta={s.teamCount(teams.length)} tight />
          <Bleed>
            <ListGroup inset={false}>
              {teams.map((t) => (
                <TeamRow
                  key={t.membership_id}
                  team={t}
                  pending={mine.filter((i) => i.teamId === t.team_id)}
                  onPress={() => router.push({ pathname: "/finance/[teamId]", params: { teamId: t.team_id } })}
                />
              ))}
            </ListGroup>
          </Bleed>
        </FadeIn>
      ) : null}

      {/* Jack's decision (spec §1): a labelled placeholder. No link, no inbox.
          Team members see it, and so does the finance office even on no team. */}
      {teams && (teams.length > 0 || isFinanceStaff(me)) ? (
        <>
          <SectionTitle title={s.officeSection} />
          <Bleed>
            <ListGroup inset={false} testID="finance-office">
              <InfoRow icon={ShieldCheck} title={s.officeApprovals} subtitle={s.officeApprovalsFor} meta={s.officeNotBuilt} />
            </ListGroup>
          </Bleed>
        </>
      ) : null}
    </LargeTitleScrollView>
  );
}

function TeamRow({ team, pending, onPress }: { team: HomeTeam; pending: OutboxItem[]; onPress: () => void }) {
  const stacked = useLargeText();
  const role = strings.roles[team.role] ?? team.role;
  const status = strings.status[team.status] ?? team.status;
  const line2 = [team.program_name, team.location ?? s.locationTbc, role].filter(Boolean).join(" · ");
  const figures = team.money ? budgetFigures(team.money.budget, team.money.spent) : null;
  const pendingText = pending.length ? s.pendingOnPhone(pending.length) : null;
  // Budgets and spending are stored in rand; a team abroad also spends locally.
  const localNote = team.money && team.money.currency !== "ZAR" ? s.spendsIn(team.money.currency) : null;
  const spokenMoney = figures
    ? `${strings.team.spent} ${moneyLabel(figures.spent, "ZAR", { cents: false })} of ${moneyLabel(figures.total, "ZAR", { cents: false })}, ${strings.team.remaining} ${moneyLabel(figures.remaining, "ZAR", { cents: false })}`
    : s.noMoney;

  return (
    <GroupRow
      onPress={onPress}
      accessibilityLabel={[team.team_name, status, line2, spokenMoney, localNote, pendingText].filter(Boolean).join(". ")}
      accessibilityHint={s.teamHint}
      testID={`team-row-${team.team_id}`}
    >
      {/* The name keeps its words whole: at large text the chip goes under it (QA: "Leadershi/p"). */}
      <View
        key={stacked ? "stacked" : "row"}
        style={
          stacked
            ? { alignItems: "flex-start", gap: space.xs }
            : { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }
        }
      >
        <Text variant="rowTitle" style={stacked ? undefined : { flex: 1, minWidth: 0 }}>
          {team.team_name}
        </Text>
        <StatusChip label={status} variant="quiet" icon={null} />
      </View>
      <Text variant="label">{line2}</Text>
      {figures ? (
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ marginTop: space.xs }}>
          <BudgetBar figures={figures} currency="ZAR" compact />
        </View>
      ) : (
        <Text variant="caption" tone="secondary" style={{ marginTop: space.xs }}>
          {s.noMoney}
        </Text>
      )}
      {localNote ? (
        <Text variant="caption" tone="secondary">
          {localNote}
        </Text>
      ) : null}
      {pendingText ? (
        <StatusLine icon={Clock} tone="attention">
          {pendingText}
        </StatusLine>
      ) : null}
    </GroupRow>
  );
}
