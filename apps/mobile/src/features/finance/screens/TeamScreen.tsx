import { useFocusEffect, useRouter } from "expo-router";
import { Clock, FileText, ImageOff, Plus } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, View } from "react-native";

import { type BackAction, Banner, Bleed, Button, ChoiceChips, GroupRow, InfoRow, FadeIn, LargeTitleList, ListGroup, ListGroupItem, ListRow, LoadError, MoneyText, NeedsYouBand, PushedPage, SectionTitle, SkeletonList, StaleNote, StatusChip, StatusLine, Text } from "@/components";
import { useSession } from "@/auth/session-provider";
import { announce } from "@/lib/a11y";
import { supabase } from "@/lib/supabase";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { userMessage } from "../api";
import { formatSavedAt } from "../cache";
import { OutboxList } from "../components/OutboxList";
import { BudgetBar } from "../components/parts";
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
const WHOLE = { cents: false };

export default function TeamScreen({ teamId }: { teamId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const load = useCallback(() => loadTeam(db, teamId), [teamId]);
  const { state, refreshing, refresh, retry } = useCachedLoad<TeamData>({
    userId,
    cacheName: `team.${teamId}`,
    load,
    errorMessage: userMessage,
  });
  const back: BackAction = { label: strings.home.title, onPress: () => router.back() };

  const [flash, setFlash] = useState<Flash | null>(null);
  // Coming back from the expense form: show what happened, and reload.
  useFocusEffect(
    useCallback(() => {
      const f = takeFlash(teamId);
      if (f) {
        setFlash(f);
        announce(f.message);
        void refresh();
      }
    }, [teamId, refresh]),
  );

  if (state.status === "loading") {
    return (
      <PushedPage back={back}>
        <Bleed>
          <SkeletonList label={strings.team.loading} count={6} inset={false} />
        </Bleed>
      </PushedPage>
    );
  }
  if (state.status === "error") {
    return (
      <PushedPage back={back}>
        <Bleed>
          <LoadError title={strings.team.errorTitle} message={state.message} onRetry={retry} />
        </Bleed>
      </PushedPage>
    );
  }

  const stale =
    state.refreshError && state.staleSince !== null ? (
      <StaleNote message={strings.common.refreshFailed(formatSavedAt(state.staleSince))} onRetry={retry} />
    ) : null;

  if (state.data.kind === "none") {
    return (
      <PushedPage back={back}>
        <Bleed style={{ gap: space.md }}>
          {stale}
          <Banner tone="error" title={strings.team.errorTitle}>
            {strings.team.notFound}
          </Banner>
        </Bleed>
      </PushedPage>
    );
  }
  if (state.data.kind === "member") {
    return <MemberView view={state.data} back={back} stale={stale} refreshing={refreshing} onRefresh={refresh} />;
  }
  return (
    <MoneyView
      view={state.data}
      teamId={teamId}
      userId={userId}
      back={back}
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
  back,
  stale,
  flash,
  refreshing,
  onRefresh,
}: {
  view: TeamMoneyView;
  teamId: string;
  userId: string | null;
  back: BackAction;
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

  const openExpense = (id: string) => router.push({ pathname: "/finance/[teamId]/expense/[expenseId]", params: { teamId, expenseId: id } });

  // Everything above the expense rows; the rows themselves are virtualised
  // (a team can log hundreds), drawn as one group with ListGroupItem.
  const header = (
    <FadeIn>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap", marginTop: -space.sm }}>
        <StatusChip label={strings.status[view.team.status] ?? view.team.status} variant="quiet" icon={null} />
        {!view.canEdit ? <StatusChip label={strings.team.viewOnly} variant="quiet" icon={null} /> : null}
        <Text variant="label">{dateRange(view.team.start_date, view.team.end_date)}</Text>
      </View>

      <Bleed style={{ gap: space.md, marginTop: space.md }}>
        {!online ? <Banner tone="offline">{strings.outbox.offline}</Banner> : null}
        {stale}
        {/* "Saved on this phone, not yet sent" is the queued note; anything else is the saved confirmation. */}
        {flash ? <Banner tone={flash.tone === "info" ? "queued" : flash.tone}>{flash.message}</Banner> : null}

        {/* The one yellow band: expenses the books can't close without. */}
        {view.canEdit && missing > 0 ? (
          <NeedsYouBand eyebrow={strings.team.needsYouTitle} text={strings.team.missingReceipts(missing)} testID="needs-you" />
        ) : null}
      </Bleed>

      {/* One big number: what's left. */}
      <View
        accessible
        accessibilityLabel={
          total.over
            ? strings.a11y.overNow(moneyLabel(-total.remaining, "ZAR", WHOLE))
            : `${strings.team.remaining}: ${moneyLabel(total.remaining, "ZAR", WHOLE)}`
        }
        style={{ marginTop: space.lg }}
      >
        <Text variant="label">{total.over ? strings.team.over : strings.team.leftToSpend}</Text>
        <MoneyText
          variant="kpi"
          tone={total.over ? "danger" : "default"}
          amount={total.over ? -total.remaining : total.remaining}
          currency="ZAR"
          options={WHOLE}
          style={{ marginTop: space.xs }}
        />
        {view.team.currency !== "ZAR" ? (
          <Text variant="caption" tone="secondary">
            {strings.team.teamSpendsIn(view.team.currency)}
          </Text>
        ) : null}
      </View>
      <View style={{ marginTop: space.sm }}>
        <BudgetBar figures={total} currency="ZAR" />
      </View>

      {view.canEdit ? (
        <Button
          label={strings.team.addExpense}
          accessibilityHint={strings.team.addExpenseHint}
          icon={<Plus size={20} color={colors.onPrimary} />}
          style={{ marginTop: space.lg }}
          onPress={() => router.push({ pathname: "/finance/[teamId]/new", params: { teamId } })}
        />
      ) : null}

      {/* Unsent items sit above the budget lines: they are money not yet in the figures. */}
      <Bleed style={{ marginTop: space.md }}>
        <OutboxList items={pendingItems} outbox={outbox} />
      </Bleed>

      {lines.length > 0 ? (
        <>
          <SectionTitle title={strings.team.budgetLines} meta={`${lines.length}`} />
          <Bleed>
            <ListGroup inset={false}>
              {lines.map((l) => (
                <GroupRow
                  key={l.categoryId}
                  accessibilityLabel={`${l.name}. ${strings.team.budget} ${moneyLabel(l.total, "ZAR", WHOLE)}, ${strings.team.spent} ${moneyLabel(l.spent, "ZAR", WHOLE)}, ${strings.team.remaining} ${moneyLabel(l.remaining, "ZAR", WHOLE)}${l.over ? `, ${strings.team.over}` : ""}`}
                >
                  <Text variant="rowTitle">{l.name}</Text>
                  <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                    <BudgetBar figures={l} currency="ZAR" compact />
                  </View>
                </GroupRow>
              ))}
            </ListGroup>
          </Bleed>
        </>
      ) : null}

      <SectionTitle title={strings.team.expenses} meta={`${shown.length} · ${formatMoney(sumBy(shown, (e) => e.zar_amount), "ZAR")}`} />
      {lines.length > 1 ? (
        <View style={{ paddingBottom: space.md }}>
          <ChoiceChips
            label={strings.a11y.expensesFilter}
            labelPlacement="inline"
            value={filter}
            onChange={setFilter}
            options={[{ value: ALL, label: strings.team.allLines }, ...lines.filter((l) => l.count > 0).map((l) => ({ value: l.categoryId, label: `${l.name} (${l.count})` }))]}
          />
        </View>
      ) : null}
    </FadeIn>
  );

  return (
    <LargeTitleList
      back={back}
      eyebrow={context}
      title={view.team.team_name}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} />}
      header={header}
      data={shown}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <Bleed>
          <ListGroupItem index={index} count={shown.length}>
            <ExpenseRow
              expense={item}
              category={categoryName.get(item.category_id) ?? strings.team.otherLine}
              receipts={receiptCount(item, view.receiptCounts)}
              waiting={receiptsFor(items, item.id, userId).length}
              onPress={() => openExpense(item.id)}
            />
          </ListGroupItem>
        </Bleed>
      )}
      empty={
        <Text tone="secondary" style={{ paddingVertical: space.sm }}>
          {filter === ALL ? strings.team.noExpenses : strings.team.noExpensesInLine}
        </Text>
      }
    />
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
  const method = strings.paymentMethods[e.payment_method] ?? e.payment_method;
  const hasLocal = Boolean(e.local_currency) && e.local_currency !== "ZAR" && e.local_amount !== null;
  const local = hasLocal ? formatMoney(e.local_amount as number, e.local_currency) : null;
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
    <ListRow
      title={e.description || e.vendor || category}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={strings.team.expenseHint}
      testID={`expense-row-${e.id}`}
      meta={
        <>
          {/* Single amounts keep their cents. */}
          <MoneyText variant="rowTitle" amount={e.zar_amount} currency="ZAR" />
          {local ? (
            <Text variant="caption" tone="secondary" style={{ fontVariant: ["tabular-nums"] }}>
              {local}
            </Text>
          ) : null}
        </>
      }
    >
      <Text variant="caption" tone="secondary">
        {e.expense_date}
      </Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: space.xs }}>
        <Text variant="caption" tone="secondary">{`${category} · ${method}`}</Text>
        {isEstimate(e) ? <StatusChip label={strings.expense.estimate} variant="attention" icon={Clock} /> : null}
        {e.source === "slack" ? <StatusChip label={strings.team.slack} variant="quiet" icon={null} /> : null}
        {/* Receipt status in words, with an icon: never colour alone. */}
        <StatusLine icon={waiting ? Clock : receipts ? FileText : ImageOff} tone={receipts && !waiting ? "positive" : "attention"}>
          {receiptText}
        </StatusLine>
      </View>
    </ListRow>
  );
}

// ── Plain members: where, when and who's going. No money (migration 260). ──

function MemberView({
  view,
  back,
  stale,
  refreshing,
  onRefresh,
}: {
  view: TeamMemberView;
  back: BackAction;
  stale: React.ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { colors } = useTheme();
  const o = view.overview;
  const role = strings.roles[o.my_role ?? ""] ?? o.my_role ?? "";
  const facts = [dateRange(o.start_date, o.end_date), strings.team.people(o.roster.length), role ? strings.team.yourRole(role) : null];
  // The roster is virtualised too (a big team), drawn as one group.
  return (
    <LargeTitleList
      back={back}
      eyebrow={[o.program_name, o.location ?? strings.home.locationTbc, o.country].filter(Boolean).join(" · ")}
      title={o.team_name}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} {...refreshControlColors(colors)} />}
      header={
        <FadeIn>
          <Text variant="label" style={{ marginTop: -space.sm }}>
            {facts.filter(Boolean).join(" · ")}
          </Text>
          {stale ? <Bleed style={{ marginTop: space.md }}>{stale}</Bleed> : null}
          <SectionTitle title={strings.team.whoIsGoing} meta={`${o.roster.length}`} />
        </FadeIn>
      }
      data={o.roster}
      keyExtractor={(p) => p.id}
      renderItem={({ item: p, index }) => {
        const name = p.name ?? strings.team.unnamed;
        const theirRole = strings.roles[p.role] ?? p.role;
        return (
          <Bleed>
            <ListGroupItem index={index} count={o.roster.length}>
              <InfoRow title={name} meta={theirRole} accessibilityLabel={`${name}, ${theirRole}`} />
            </ListGroupItem>
          </Bleed>
        );
      }}
      footer={
        <Text tone="secondary" style={{ marginTop: space.lg }}>
          {strings.team.memberNote}
        </Text>
      }
    />
  );
}
