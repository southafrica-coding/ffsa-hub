import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Clock, Pencil, UsersRound } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Alert, RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, EmptyState, LargeTitleScrollView, ListGroup, ListRow, NeedsYouBand, SkeletonList, StatusChip, Text } from "@/components";
import { Bleed, LoadError } from "@/features/finance/components/parts";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { apiFetch } from "@/lib/api-client";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { approveMember, getMinistry, isForbidden, loadErrorMessage, type MinistryDetail, type RosterMember } from "../api";
import { Freshness, SectionCount } from "../components/ui";
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
  const router = useRouter();
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

  // Whether anything sits between the title and the description (it sets the spacing).
  const topNotes = (state.status === "ready" && state.staleSince !== null) || actionError !== null || pending.length > 0;

  return (
    <LargeTitleScrollView
      back={{ label: strings.list.title, onPress: () => router.back() }}
      eyebrow={data ? detailContext(data.ministry) : strings.list.context}
      title={data ? data.ministry.name : strings.list.title}
      gap={0}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
    >
      <Bleed style={{ gap: space.md }}>
        {state.status === "loading" ? <SkeletonList label={s.loading} count={5} inset={false} /> : null}
        {forbidden ? (
          <EmptyState testID="forbidden" icon={UsersRound} title={strings.gate.title} body={strings.common.forbidden} />
        ) : state.status === "error" ? (
          <LoadError title={s.errorTitle} message={state.message} onRetry={retry} />
        ) : null}
        <Freshness state={state} onRetry={retry} />
        {actionError ? <Banner tone="error">{actionError}</Banner> : null}

        {/* The one yellow band. It has no button: Approve sits on the person's own row. */}
        {pending.length > 0 ? (
          <NeedsYouBand
            eyebrow={s.needsYouTitle}
            text={pending.length === 1 ? s.needsYouOne(pending[0].name) : s.needsYouMany(pending.length)}
            testID="needs-you"
          />
        ) : null}
      </Bleed>

      {data ? (
        <>
          {data.ministry.description ? (
            <Text tone="secondary" style={{ marginTop: topNotes ? space.lg : 0 }}>
              {data.ministry.description}
            </Text>
          ) : null}
          {!data.canManage ? (
            <Text variant="caption" tone="secondary" testID="read-only" style={{ marginTop: space.sm }}>
              {s.readOnly}
            </Text>
          ) : null}

          <Team detail={data} approving={approving} onApprove={confirmApprove} />

          {data.canManage ? (
            <Bleed style={{ marginTop: space.xl }}>
              <ListGroup inset={false}>
                <ListRow
                  icon={Pencil}
                  title={s.manageWeb}
                  subtitle={s.manageWebSub}
                  trailing="web"
                  accessibilityHint={s.manageWebHint}
                  onPress={() => void openWebPage(`/ministry/${data.ministry.id}`, colors)}
                  testID="manage-web"
                />
              </ListGroup>
            </Bleed>
          ) : null}
        </>
      ) : null}
    </LargeTitleScrollView>
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
      <SectionCount title={s.team} count={detail.roster.length} tight />
      {detail.roster.length === 0 ? (
        <Text tone="secondary" style={{ paddingVertical: space.sm }} testID="empty-team">
          {s.emptyTeam}
        </Text>
      ) : (
        groups.map((g, i) => (
          <View key={g.key} style={{ marginTop: g.label && i > 0 ? space.lg : 0 }}>
            {g.label ? (
              <Text variant="label" accessibilityRole="header" accessibilityLabel={s.groupA11y(g.label, g.rows.length)} style={{ paddingBottom: 6 }}>
                {`${g.label} (${g.rows.length})`}
              </Text>
            ) : null}
            {g.rows.length === 0 ? (
              <Text tone="secondary" style={{ paddingVertical: space.sm }}>
                {s.emptyGroup}
              </Text>
            ) : (
              <Bleed>
                <ListGroup inset={false} testID={`group-${g.key}`}>
                  {g.rows.map((r) => (
                    <MemberRow
                      key={`${g.key}:${r.membershipId}`}
                      member={r}
                      groupKey={g.key}
                      canApprove={detail.canManage && r.status === "pending"}
                      approving={approving === r.membershipId}
                      busy={approving !== null}
                      onApprove={() => onApprove(r)}
                    />
                  ))}
                </ListGroup>
              </Bleed>
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
  const badges = memberBadges(r, groupKey);
  return (
    <View
      style={{ minHeight: 56, justifyContent: "center", paddingVertical: space.md, paddingLeft: space.lg, paddingRight: space.md, gap: space.md }}
      testID={`member-${groupKey}-${r.membershipId}`}
    >
      {/* One stop for the screen reader: name, role words, email. */}
      <View accessible accessibilityLabel={memberA11yLabel(r, groupKey)} style={{ gap: 2 }}>
        <Text variant="rowTitle">{r.name}</Text>
        {r.email ? (
          <Text variant="caption" tone="secondary">
            {r.email}
          </Text>
        ) : null}
        {badges.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {badges.map((b) =>
              b === strings.detail.pending ? (
                <StatusChip key={b} label={b} variant="attention" icon={Clock} />
              ) : (
                // A role is the word itself; only the waiting state carries an icon.
                <StatusChip key={b} label={b} variant="neutral" icon={null} />
              ),
            )}
          </View>
        ) : null}
      </View>
      {canApprove ? (
        <View style={{ alignSelf: "flex-start" }}>
          <Button
            label={s.approve}
            variant="secondary"
            size="small"
            loading={approving}
            disabled={busy}
            accessibilityLabel={s.approveA11y(r.name)}
            accessibilityHint={s.approveHint}
            onPress={onApprove}
            testID={`approve-${r.membershipId}`}
            style={{ paddingHorizontal: space.xl }}
          />
        </View>
      ) : null}
    </View>
  );
}
