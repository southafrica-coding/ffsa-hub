import { useRouter } from "expo-router";
import { Inbox, Plus } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Masthead, Screen } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { ErrorState, SectionBar, Skeleton, StaleNote } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { ListRow, StateMessage, useMe } from "@/features/shell";
import { useTheme } from "@/theme/use-theme";

import { bookingsAccess } from "../access";
import { loadErrorMessage } from "../api";
import { BookingRow } from "../components/ui";
import { QueueList } from "../components/QueueList";
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

// Bookings home: my requests grouped Waiting / Upcoming / Past, a "new
// request" button, and (for approvers) the one yellow band when something
// is waiting for them. The last good list is kept on the phone.
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

  function openItem(i: BookingItem) {
    router.push({ pathname: i.kind === "space" ? "/bookings/space/[id]" : "/bookings/vehicle/[id]", params: { id: i.id } });
  }

  if (me.status === "loading") {
    return (
      <Screen edges={[]}>
        <Masthead context={s.context} title={s.title} />
        <Skeleton label={s.loading} />
      </Screen>
    );
  }
  if (me.status === "error" && !me.me) {
    return (
      <Screen edges={[]}>
        <Masthead context={s.context} title={s.title} />
        <ErrorState title={s.title} message={me.error ?? strings.common.generic} onRetry={() => void me.refresh()} />
      </Screen>
    );
  }
  if (!access.any) {
    return (
      <Screen edges={[]}>
        <Masthead context={s.context} title={s.title} />
        <StateMessage testID="no-access" title={s.noAccessTitle} body={s.noAccessBody} />
      </Screen>
    );
  }

  const groups = state.status === "ready" ? groupBookings(state.data.items, todayISO()) : null;
  const pendingCount = state.status === "ready" ? state.data.pendingCount : null;

  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text} colors={[colors.text]} />}
      >
        <Masthead context={s.context} title={s.title} />

        {/* The one yellow band: only for approvers, only when requests really wait. */}
        {pendingCount ? (
          <Banner
            tone="needsYou"
            title={s.needsYouTitle}
            testID="needs-you"
            action={<Button label={s.review} variant="primary" onPress={() => router.push("/bookings/approvals")} />}
          >
            {s.needsYou(pendingCount)}
          </Banner>
        ) : null}

        {canRequest ? (
          <Button
            label={s.newRequest}
            accessibilityHint={s.newRequestHint}
            icon={<Plus size={18} color={colors.onInverse} />}
            onPress={() => router.push("/bookings/new")}
            testID="new-request"
          />
        ) : null}

        {approver ? (
          <ListRow icon={Inbox} title={s.approvalsRow} subtitle={s.approvalsRowSub(pendingCount)} onPress={() => router.push("/bookings/approvals")} testID="approvals-row" />
        ) : null}

        {myQueue.length > 0 ? <QueueList items={myQueue} outbox={outbox} online={online} /> : null}

        {state.status === "loading" ? <Skeleton label={s.loading} /> : null}
        {state.status === "error" ? <ErrorState title={s.title} message={state.message} onRetry={retry} /> : null}
        {state.status === "ready" && state.refreshError && state.staleSince !== null ? (
          <StaleNote message={online ? strings.common.refreshFailed(formatSavedAt(state.staleSince)) : strings.common.offline} onRetry={retry} />
        ) : null}

        {groups && state.status === "ready" && state.data.items.length === 0 ? (
          <StateMessage testID="empty" icon={Inbox} title={s.emptyTitle} body={s.empty} />
        ) : null}

        {groups ? (
          <>
            <Group title={s.sections.waiting} items={groups.waiting} onOpen={openItem} />
            <Group title={s.sections.upcoming} items={groups.upcoming} onOpen={openItem} />
            <Group title={s.sections.past} items={groups.past.slice(0, PAST_LIMIT)} onOpen={openItem} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Group({ title, items, onOpen }: { title: string; items: BookingItem[]; onOpen: (i: BookingItem) => void }) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionBar title={title} meta={String(items.length)} />
      {items.map((i) => (
        <BookingRow key={`${i.kind}-${i.id}`} item={i} onPress={() => onOpen(i)} />
      ))}
    </View>
  );
}
