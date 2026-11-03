import { useFocusEffect, useRouter } from "expo-router";
import { FileText, ImageOff } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { AccessibilityInfo, FlatList, RefreshControl, View } from "react-native";

import { Banner, Button, Masthead, Screen, Text } from "@/components";
import { useSession } from "@/auth/session-provider";
import { supabase } from "@/lib/supabase";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { userMessage } from "../api";
import { formatSavedAt } from "../cache";
import { OutboxList } from "../components/OutboxList";
import { BudgetBar, Chips, ErrorState, Row, SectionBar, Skeleton, StaleNote, Tag } from "../components/ui";
import { loadTeam, receiptCount, type ReadClient, type TeamData, type TeamMemberView, type TeamMoneyView } from "../data";
import { takeFlash, type Flash } from "../flash";
import { budgetFigures, budgetLines, formatMoney, moneyLabel, sumBy } from "../money";
import { useOutbox } from "../outbox/provider";
import { forTeam, receiptsFor } from "../outbox/state";
import { strings } from "../strings";
import type { Expense } from "../types";
import { useCachedLoad } from "../use-cached-load";

import { dateRange } from "./HomeScreen";

const db = supabase as unknown as ReadClient;
const ALL = "__all__";

export default function TeamScreen({ teamId }: { teamId: string }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const load = useCallback(() => loadTeam(db, teamId), [teamId]);
  const { state, refreshing, refresh, retry } = useCachedLoad<TeamData>({
    userId,
    cacheName: `team.${teamId}`,
    load,
    errorMessage: userMessage,
  });

  const [flash, setFlash] = useState<Flash | null>(null);
  // Coming back from the expense form: show what happened, and reload.
  useFocusEffect(
    useCallback(() => {
      const f = takeFlash(teamId);
      if (f) {
        setFlash(f);
        AccessibilityInfo.announceForAccessibility(f.message);
        void refresh();
      }
    }, [teamId, refresh]),
  );

  if (state.status === "loading") {
    return (
      <Screen edges={["bottom"]}>
        <Skeleton label={strings.team.loading} rows={6} />
      </Screen>
    );
  }
  if (state.status === "error") {
    return (
      <Screen edges={["bottom"]}>
        <ErrorState title={strings.team.errorTitle} message={state.message} onRetry={retry} />
      </Screen>
    );
  }

  const stale =
    state.refreshError && state.staleSince !== null ? (
      <StaleNote message={strings.common.refreshFailed(formatSavedAt(state.staleSince))} onRetry={retry} />
    ) : null;

  if (state.data.kind === "none") {
    return (
      <Screen edges={["bottom"]}>
        {stale}
        <Banner tone="danger" title={strings.team.errorTitle}>
          {strings.team.notFound}
        </Banner>
      </Screen>
    );
  }
  if (state.data.kind === "member") {
    return <MemberView view={state.data} stale={stale} refreshing={refreshing} onRefresh={refresh} />;
  }
  return (
    <MoneyView
      view={state.data}
      teamId={teamId}
      userId={userId}
      stale={stale}
      flash={flash}
      refreshing={refreshing}
      onRefresh={refresh}
    />
  );
}

// ── Leaders, managers and finance staff: the money ──────────────────────────

function MoneyView({
  view,
  teamId,
  userId,
  stale,
  flash,
  refreshing,
  onRefresh,
}: {
  view: TeamMoneyView;
  teamId: string;
  userId: string | null;
  stale: React.ReactNode;
  flash: Flash | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { items, outbox, online } = useOutbox();
  const [filter, setFilter] = useState<string>(ALL);

  const lines = useMemo(() => budgetLines(view.categories, view.budgets, view.expenses), [view]);
  const total = budgetFigures(sumBy(view.budgets, (b) => b.budget_amount_zar), sumBy(view.expenses, (e) => e.zar_amount));
  const pending = forTeam(items, teamId, userId);
  const pendingItems = [...pending.expenses, ...pending.receipts.filter((r) => !pending.expenses.some((e) => e.id === r.expenseId))];
  const shown = filter === ALL ? view.expenses : view.expenses.filter((e) => e.category_id === filter);
  const missing = view.expenses.filter((e) => receiptCount(e, view.receiptCounts) === 0 && receiptsFor(items, e.id, userId).length === 0).length;
  const categoryName = useMemo(() => new Map(view.categories.map((c) => [c.id, c.name])), [view.categories]);
  const context = [view.team.location ?? strings.home.locationTbc, view.team.country].filter(Boolean).join(" · ");

  const header = (
    <View style={{ gap: 16, paddingBottom: 8 }}>
      <Masthead context={context} title={view.team.team_name} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Tag>{strings.status[view.team.status] ?? view.team.status}</Tag>
        {!view.canEdit ? <Tag>{strings.team.viewOnly}</Tag> : null}
        <Text variant="label" tone="secondary">
          {dateRange(view.team.start_date, view.team.end_date)}
        </Text>
      </View>

      {!online ? <Banner tone="info">{strings.outbox.offline}</Banner> : null}
      {stale}
      {flash ? <Banner tone={flash.tone}>{flash.message}</Banner> : null}

      {/* The one yellow band: expenses the books can't close without. */}
      {view.canEdit && missing > 0 ? (
        <Banner tone="needsYou" title={strings.team.needsYouTitle} testID="needs-you">
          {strings.team.missingReceipts(missing)}
        </Banner>
      ) : null}

      {/* One big number: what's left. */}
      <View
        accessible
        accessibilityLabel={`${strings.team.remaining}: ${moneyLabel(total.remaining, "ZAR", { cents: false })}`}
        style={{ gap: 4 }}
      >
        <Text variant="label" tone="secondary">
          {total.over ? strings.team.over : `${strings.team.remaining} to spend`}
        </Text>
        <Text variant="numeral" tone={total.over ? "danger" : "default"}>
          {formatMoney(total.remaining, "ZAR", { cents: false })}
        </Text>
        {view.team.currency !== "ZAR" ? (
          <Text variant="caption" tone="secondary">{`Figures in rand · the team spends in ${view.team.currency}`}</Text>
        ) : null}
      </View>
      <BudgetBar figures={total} currency="ZAR" />

      {view.canEdit ? (
        <Button
          label={strings.team.addExpense}
          accessibilityHint={strings.team.addExpenseHint}
          onPress={() => router.push({ pathname: "/finance/[teamId]/new", params: { teamId } })}
        />
      ) : null}

      <OutboxList items={pendingItems} outbox={outbox} />

      {lines.length > 0 ? (
        <View>
          <SectionBar title={strings.team.budgetLines} meta={`${lines.length}`} />
          {lines.map((l) => (
            <Row key={l.categoryId} accessibilityLabel={`${l.name}. ${strings.team.budget} ${moneyLabel(l.total, "ZAR", { cents: false })}, ${strings.team.spent} ${moneyLabel(l.spent, "ZAR", { cents: false })}, ${strings.team.remaining} ${moneyLabel(l.remaining, "ZAR", { cents: false })}${l.over ? `, ${strings.team.over}` : ""}`}>
              <Text variant="bodyStrong">{l.name}</Text>
              <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <BudgetBar figures={l} currency="ZAR" compact />
              </View>
            </Row>
          ))}
        </View>
      ) : null}

      <SectionBar
        title={strings.team.expenses}
        meta={`${shown.length} · ${formatMoney(sumBy(shown, (e) => e.zar_amount), "ZAR")}`}
      />
      {lines.length > 1 ? (
        <Chips
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[{ value: ALL, label: strings.team.allLines }, ...lines.filter((l) => l.count > 0).map((l) => ({ value: l.categoryId, label: `${l.name} (${l.count})` }))]}
        />
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false} edges={["bottom"]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <FlatList
        data={shown}
        keyExtractor={(e) => e.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} />}
        ListEmptyComponent={
          <Text tone="secondary" style={{ paddingVertical: 16 }}>
            {filter === ALL ? strings.team.noExpenses : strings.team.noExpensesInLine}
          </Text>
        }
        renderItem={({ item }) => (
          <ExpenseRow
            expense={item}
            category={categoryName.get(item.category_id) ?? "Other"}
            receipts={receiptCount(item, view.receiptCounts)}
            waiting={receiptsFor(items, item.id, userId).length}
            onPress={() => router.push({ pathname: "/finance/[teamId]/expense/[expenseId]", params: { teamId, expenseId: item.id } })}
          />
        )}
      />
    </Screen>
  );
}

export function isEstimate(e: Expense) {
  return e.payment_method === "card" && !!e.local_currency && e.local_currency !== "ZAR" && !e.zar_confirmed;
}

function ExpenseRow({
  expense: e,
  category,
  receipts,
  waiting,
  onPress,
}: {
  expense: Expense;
  category: string;
  receipts: number;
  waiting: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const method = strings.paymentMethods[e.payment_method] ?? e.payment_method;
  const local =
    e.local_currency && e.local_currency !== "ZAR" && e.local_amount !== null ? formatMoney(e.local_amount, e.local_currency) : null;
  const receiptText = waiting
    ? strings.outbox.pendingReceipts(waiting)
    : receipts
      ? strings.expense.receiptCount(receipts)
      : strings.expense.noReceipt;
  const label = [
    e.expense_date,
    e.description ?? "",
    moneyLabel(e.zar_amount, "ZAR"),
    local,
    category,
    method,
    isEstimate(e) ? strings.expense.estimate : null,
    receiptText,
    e.source === "slack" ? strings.expense.fromSlack : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Row onPress={onPress} accessibilityLabel={label} accessibilityHint="Opens the expense and its receipts" testID={`expense-row-${e.id}`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" tone="secondary">
            {e.expense_date}
          </Text>
          <Text variant="bodyStrong" numberOfLines={2}>
            {e.description || e.vendor || category}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
            {formatMoney(e.zar_amount, "ZAR")}
          </Text>
          {local ? (
            <Text variant="caption" tone="secondary">
              {local}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Text variant="caption" tone="secondary">{`${category} · ${method}`}</Text>
        {isEstimate(e) ? <Tag tone="attention">{strings.expense.estimate}</Tag> : null}
        {e.source === "slack" ? <Tag>Slack</Tag> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {receipts || waiting ? (
            <FileText size={16} color={waiting ? colors.attention : colors.positiveText} />
          ) : (
            <ImageOff size={16} color={colors.attention} />
          )}
          <Text variant="caption" tone={receipts && !waiting ? "positive" : "attention"}>
            {receiptText}
          </Text>
        </View>
      </View>
    </Row>
  );
}

// ── Plain members: where, when and who's going. No money (migration 260). ──

function MemberView({
  view,
  stale,
  refreshing,
  onRefresh,
}: {
  view: TeamMemberView;
  stale: React.ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { colors } = useTheme();
  const o = view.overview;
  const role = strings.roles[o.my_role ?? ""] ?? o.my_role ?? "";
  return (
    <Screen scroll={false} edges={["bottom"]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <FlatList
        data={o.roster}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} />}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 8 }}>
            <Masthead context={[o.program_name, o.location ?? strings.home.locationTbc, o.country].filter(Boolean).join(" · ")} title={o.team_name} />
            {stale}
            <Text variant="label" tone="secondary">
              {`${dateRange(o.start_date, o.end_date)} · ${o.roster.length} ${o.roster.length === 1 ? "person" : "people"}${role ? ` · you're a ${role.toLowerCase()}` : ""}`}
            </Text>
            <SectionBar title={strings.team.whoIsGoing} meta={`${o.roster.length}`} />
          </View>
        }
        ListFooterComponent={
          <Text tone="secondary" style={{ paddingVertical: 16 }}>
            {strings.team.memberNote}
          </Text>
        }
        renderItem={({ item }) => (
          <Row accessibilityLabel={`${item.name ?? "Unnamed"}, ${strings.roles[item.role] ?? item.role}`}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Text style={{ flex: 1 }}>{item.name ?? "Unnamed"}</Text>
              <Text variant="label" tone="secondary">
                {strings.roles[item.role] ?? item.role}
              </Text>
            </View>
          </Row>
        )}
      />
    </Screen>
  );
}
