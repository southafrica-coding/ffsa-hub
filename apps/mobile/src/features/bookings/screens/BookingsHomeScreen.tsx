import { useRouter } from "expo-router";
import { Check, Inbox, Plus } from "lucide-react-native";
import { useCallback, useMemo, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Button, EmptyState, LargeTitleScrollView, ListGroup, ListRow, NeedsYouBand, SkeletonList, type BackAction } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { useMe } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { bookingsAccess } from "../access";
import { loadErrorMessage } from "../api";
import { QueueList } from "../components/QueueList";
import { Bleed, BookingRow, LoadFailed, SectionTitle, StaleNote } from "../components/ui";
import { loadMine, loadPending } from "../data";
import { groupBookings, spaceItem, todayISO, vehicleItem, type BookingItem } from "../logic";
import { useBookingsOutbox } from "../outbox/provider";
import { strings } from "../strings";

const s = strings.home;
const PAST_LIMIT = 20;

export type HomeData = {
  items: BookingItem[];
  /** Waiting for this person to decide; null when they approve nothing. */
  pendingCount: number | null;
};

/** What the Bookings home loads: my requests, and for approvers how many wait. */
export async function loadHomeData(userId: string, access: ReturnType<typeof bookingsAccess>): Promise<HomeData> {
  const [mine, pending] = await Promise.all([
    loadMine(userId, { spaces: access.spaces.view, vehicles: access.vehicles.view }),
    access.approver ? loadPending({ spaces: access.spaces.approve, vehicles: access.vehicles.approve }) : Promise.resolve(null),
  ]);
  return {
    items: [...mine.spaces.map(spaceItem), ...mine.vehicles.map(vehicleItem)],
    pendingCount: pending ? pending.spaces.length + pending.vehicles.length : null,
  };
}

// Bookings home (frames 7.1, 13.2): my requests in stacked sections
// (Waiting / Upcoming / Past), a "New request" button, and for approvers the
// one yellow band when something is waiting for them plus the "Waiting for
// you" row. The last good list is kept on the phone.
export default function BookingsHomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const me = useMe();
  const access = useMemo(() => bookingsAccess(me.me), [me.me]);
  const { items: queued, outbox, online } = useBookingsOutbox();
  const myQueue = queued.filter((i) => i.userId === userId);

  const ready = me.status === "ready" && access.any && !!userId;
  const { approver } = access;
  const load = useCallback(
    () => (userId && access.any ? loadHomeData(userId, access) : Promise.resolve<HomeData>({ items: [], pendingCount: null })),
    [userId, access],
  );
  const { state, refreshing, refresh, retry } = useCachedLoad<HomeData>({
    userId: ready ? userId : null,
    cacheName: "bookings.home",
    load,
    errorMessage: loadErrorMessage,
  });

  const canRequest = access.spaces.request || access.vehicles.request;
  // Bookings is reached from Home (it isn't a tab), so its first screen goes back to Home.
  const back: BackAction = { label: strings.common.home, onPress: () => router.navigate("/") };

  function openItem(i: BookingItem) {
    router.push({ pathname: i.kind === "space" ? "/bookings/space/[id]" : "/bookings/vehicle/[id]", params: { id: i.id } });
  }

  const page = (children: ReactNode, refreshable = false) => (
    <LargeTitleScrollView
      back={back}
      eyebrow={s.context}
      title={s.title}
      gap={0}
      refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} /> : undefined}
    >
      {children}
    </LargeTitleScrollView>
  );

  if (me.status === "loading") {
    return page(
      <Bleed>
        <SkeletonList label={s.loading} count={4} inset={false} />
      </Bleed>,
    );
  }
  if (me.status === "error" && !me.me) {
    return page(
      <Bleed>
        <LoadFailed title={s.errorTitle} message={me.error ?? strings.common.generic} onRetry={() => void me.refresh()} />
      </Bleed>,
    );
  }
  if (!access.any) {
    return page(
      <Bleed>
        <EmptyState testID="no-access" title={s.noAccessTitle} body={s.noAccessBody} />
      </Bleed>,
    );
  }

  const groups = state.status === "ready" ? groupBookings(state.data.items, todayISO()) : null;
  const pendingCount = state.status === "ready" ? state.data.pendingCount : null;

  return page(
    <>
      <Bleed style={{ gap: space.md }}>
        {/* The one yellow band: only for approvers, only when requests really wait. */}
        {pendingCount ? (
          <NeedsYouBand
            eyebrow={s.needsYouTitle}
            text={s.needsYou(pendingCount)}
            actionLabel={s.review}
            onAction={() => router.push("/bookings/approvals")}
            testID="needs-you"
          />
        ) : null}

        {canRequest ? (
          <Button
            label={s.newRequest}
            accessibilityHint={s.newRequestHint}
            icon={<Plus size={20} color={colors.onPrimary} />}
            onPress={() => router.push("/bookings/new")}
            testID="new-request"
          />
        ) : null}

        {approver ? (
          <ListGroup inset={false}>
            <ListRow icon={Check} title={s.approvalsRow} subtitle={s.approvalsRowSub(pendingCount)} onPress={() => router.push("/bookings/approvals")} testID="approvals-row" />
          </ListGroup>
        ) : null}

        {myQueue.length > 0 ? <QueueList items={myQueue} outbox={outbox} online={online} /> : null}

        {state.status === "loading" ? <SkeletonList label={s.loading} count={4} inset={false} /> : null}
        {state.status === "error" ? <LoadFailed title={s.errorTitle} message={state.message} onRetry={retry} /> : null}
        {state.status === "ready" && state.refreshError && state.staleSince !== null ? (
          <StaleNote message={online ? strings.common.refreshFailed(formatSavedAt(state.staleSince)) : strings.common.offline} onRetry={retry} />
        ) : null}

        {groups && state.status === "ready" && state.data.items.length === 0 ? <EmptyState testID="empty" icon={Inbox} title={s.emptyTitle} body={s.empty} /> : null}
      </Bleed>

      {groups ? (
        <>
          <Group title={s.sections.waiting} items={groups.waiting} onOpen={openItem} />
          <Group title={s.sections.upcoming} items={groups.upcoming} onOpen={openItem} />
          <Group title={s.sections.past} items={groups.past.slice(0, PAST_LIMIT)} onOpen={openItem} />
        </>
      ) : null}
    </>,
    true,
  );
}

function Group({ title, items, onOpen }: { title: string; items: BookingItem[]; onOpen: (i: BookingItem) => void }) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionTitle title={title} meta={String(items.length)} />
      <Bleed>
        <ListGroup inset={false}>
          {items.map((i) => (
            <BookingRow key={`${i.kind}-${i.id}`} item={i} onPress={() => onOpen(i)} />
          ))}
        </ListGroup>
      </Bleed>
    </View>
  );
}
