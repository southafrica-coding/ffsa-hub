import * as Haptics from "expo-haptics";
import { Settings2, UsersRound } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Masthead, Screen, Text } from "@/components";
import { ErrorState, SectionBar, Skeleton, Tag } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { Freshness } from "@/features/schools/components/ui";
import { ListRow, StateMessage, openWebPage } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { apiFetch } from "@/lib/api-client";
import { hairline, touch } from "@/theme/tokens";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { approveMember, getMinistry, isForbidden, loadErrorMessage, type MinistryDetail, type RosterMember } from "../api";
import { detailContext, isUuid, memberA11yLabel, memberBadges, pendingMembers, rosterGroups } from "../logic";
import { strings } from "../strings";

const s = strings.detail;

// One ministry's team, grouped by sub-category like the web page. Everyone
// who can open it sees the same list; leaders and admins (canManage, decided
// by the server) can also approve people waiting to join, and are pointed at
// the website for everything else (adding, removing, leaders, categories).
// The page's one yellow band is "people are waiting for you to approve
// them", shown only to those who can approve.
export default function MinistryDetailScreen({ id }: { id: string }) {
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const validId = isUuid(id);

  const load = useCallback(
    () => (validId ? getMinistry(apiFetch, id) : Promise.reject(new Error("not found"))),
    [id, validId],
  );
  // Both must be stable, or useCachedLoad reloads on every render.
  const errorMessage = useCallback((err: unknown) => (validId ? loadErrorMessage(err) : strings.common.notFound), [validId]);
  const { state, refreshing, refresh, retry } = useCachedLoad<MinistryDetail>({
    userId,
    cacheName: `ministries.detail.${validId ? id : "invalid"}`,
    load,
    errorMessage,
  });

  const [approving, setApproving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const data = state.status === "ready" ? state.data : null;
  const forbidden = state.status === "error" && state.message === strings.common.forbidden;
  const pending = data?.canManage ? pendingMembers(data.roster) : [];

  const approve = useCallback(
    async (member: RosterMember) => {
      setApproving(member.membershipId);
      setActionError(null);
      try {
        await approveMember(apiFetch, id, member.membershipId);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        announce(s.approved(member.name));
        await refresh();
      } catch (err) {
        setActionError(isForbidden(err) ? s.approveForbidden : s.approveFailed);
      } finally {
        setApproving(null);
      }
    },
    [id, refresh],
  );

  const confirmApprove = useCallback(
    (member: RosterMember) => {
      if (!data) return;
      Alert.alert(s.approveConfirmTitle(member.name), s.approveConfirmBody(data.ministry.name), [
        { text: s.approveNo, style: "cancel" },
        { text: s.approveYes, onPress: () => void approve(member) },
      ]);
    },
    [approve, data],
  );

  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        <Masthead context={data ? detailContext(data.ministry) : strings.list.context} title={data ? data.ministry.name : strings.list.title} />

        {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
        {forbidden ? (
          <StateMessage testID="forbidden" icon={UsersRound} title={strings.gate.title} body={strings.common.forbidden} />
        ) : state.status === "error" ? (
          <ErrorState title={s.errorTitle} message={state.message} onRetry={retry} />
        ) : null}
        <Freshness state={state} onRetry={retry} />
        {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

        {pending.length > 0 ? (
          <Banner tone="needsYou" title={s.needsYouTitle} testID="needs-you">
            {pending.length === 1 ? s.needsYouOne(pending[0].name) : s.needsYouMany(pending.length)}
          </Banner>
        ) : null}

        {data ? (
          <>
            {data.ministry.description ? <Text tone="secondary">{data.ministry.description}</Text> : null}
            {!data.canManage ? (
              <Text variant="caption" tone="secondary" testID="read-only">
                {s.readOnly}
              </Text>
            ) : null}

            <Team detail={data} approving={approving} onApprove={confirmApprove} />

            {data.canManage ? (
              <View>
                <ListRow
                  icon={Settings2}
                  title={s.manageWeb}
                  subtitle={s.manageWebSub}
                  trailing="web"
                  accessibilityHint={s.manageWebHint}
                  onPress={() => void openWebPage(`/ministry/${data.ministry.id}`, colors)}
                  testID="manage-web"
                />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Team({
  detail,
  approving,
  onApprove,
}: {
  detail: MinistryDetail;
  approving: string | null;
  onApprove: (m: RosterMember) => void;
}) {
  const groups = rosterGroups(detail);
  return (
    <View>
      <SectionBar title={s.team} meta={String(detail.roster.length)} />
      {detail.roster.length === 0 ? (
        <Text tone="secondary" style={{ paddingVertical: 16 }} testID="empty-team">
          {s.emptyTeam}
        </Text>
      ) : (
        groups.map((g) => (
          <View key={g.key} style={{ marginTop: g.label ? 12 : 0 }}>
            {g.label ? (
              <Text variant="label" tone="secondary" accessibilityRole="header" accessibilityLabel={s.groupA11y(g.label, g.rows.length)} style={{ paddingVertical: 6 }}>
                {`${g.label} (${g.rows.length})`}
              </Text>
            ) : null}
            {g.rows.length === 0 ? (
              <Text tone="secondary" style={{ paddingVertical: 8 }}>
                {s.emptyGroup}
              </Text>
            ) : (
              g.rows.map((r) => (
                <MemberRow
                  key={`${g.key}:${r.membershipId}`}
                  member={r}
                  groupKey={g.key}
                  canApprove={detail.canManage && r.status === "pending"}
                  approving={approving === r.membershipId}
                  busy={approving !== null}
                  onApprove={() => onApprove(r)}
                />
              ))
            )}
          </View>
        ))
      )}
    </View>
  );
}

function MemberRow({
  member: r,
  groupKey,
  canApprove,
  approving,
  busy,
  onApprove,
}: {
  member: RosterMember;
  groupKey: string;
  canApprove: boolean;
  approving: boolean;
  busy: boolean;
  onApprove: () => void;
}) {
  const { colors } = useTheme();
  const badges = memberBadges(r, groupKey);
  return (
    <View
      style={{ minHeight: touch.minTarget, paddingVertical: 12, borderBottomWidth: hairline, borderBottomColor: colors.rule, gap: 8 }}
      testID={`member-${groupKey}-${r.membershipId}`}
    >
      {/* One stop for the screen reader: name, role words, email. */}
      <View accessible accessibilityLabel={memberA11yLabel(r, groupKey)} style={{ gap: 4 }}>
        <Text variant="bodyStrong">{r.name}</Text>
        {r.email ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {r.email}
          </Text>
        ) : null}
        {badges.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {badges.map((b) => (
              <Tag key={b} tone={b === strings.detail.pending ? "attention" : "default"}>
                {b}
              </Tag>
            ))}
          </View>
        ) : null}
      </View>
      {canApprove ? (
        <View style={{ alignSelf: "flex-start" }}>
          <Button
            label={s.approve}
            variant="secondary"
            loading={approving}
            disabled={busy}
            accessibilityLabel={s.approveA11y(r.name)}
            accessibilityHint={s.approveHint}
            onPress={onApprove}
            testID={`approve-${r.membershipId}`}
          />
        </View>
      ) : null}
    </View>
  );
}
