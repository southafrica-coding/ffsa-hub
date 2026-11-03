import { useRouter } from "expo-router";
import { ClipboardCheck } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Masthead, Screen } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { ErrorState, SectionBar, Skeleton, StaleNote } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { StateMessage, useMe } from "@/features/shell";
import { useTheme } from "@/theme/use-theme";

import { bookingsAccess } from "../access";
import { loadErrorMessage } from "../api";
import { BookingRow } from "../components/ui";
import { loadPending, type Pending } from "../data";
import { spaceItem, vehicleItem, type BookingItem } from "../logic";
import { strings } from "../strings";

const a = strings.approvals;

// "Waiting for you": every pending space and vehicle request this person
// may decide, soonest first (the web's two request queues). No yellow band:
// the whole screen is the queue, so a band would point at itself (as on web).
export default function ApprovalsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const me = useMe();
  const access = useMemo(() => bookingsAccess(me.me), [me.me]);
  const allowed = me.status === "ready" && access.approver;

  const load = useCallback(
    () => (access.approver ? loadPending({ spaces: access.spaces.approve, vehicles: access.vehicles.approve }) : Promise.resolve<Pending>({ spaces: [], vehicles: [] })),
    [access],
  );
  const { state, refreshing, refresh, retry } = useCachedLoad<Pending>({
    userId: allowed ? userId : null,
    cacheName: "bookings.pending",
    load,
    errorMessage: loadErrorMessage,
  });

  if (me.status === "loading") {
    return (
      <Screen edges={[]}>
        <Masthead context={a.context} title={a.title} />
        <Skeleton label={a.loading} />
      </Screen>
    );
  }
  if (!access.approver) {
    return (
      <Screen edges={[]}>
        <Masthead context={a.context} title={a.title} />
        <StateMessage testID="no-access" title={a.noAccessTitle} body={a.noAccessBody} />
      </Screen>
    );
  }

  function open(i: BookingItem) {
    router.push({ pathname: i.kind === "space" ? "/bookings/space/[id]" : "/bookings/vehicle/[id]", params: { id: i.id } });
  }

  const spaces = state.status === "ready" ? state.data.spaces : [];
  const vehicles = state.status === "ready" ? state.data.vehicles : [];

  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text} colors={[colors.text]} />}
      >
        <Masthead context={a.context} title={a.title} />
        {state.status === "loading" ? <Skeleton label={a.loading} /> : null}
        {state.status === "error" ? <ErrorState title={a.title} message={state.message} onRetry={retry} /> : null}
        {state.status === "ready" && state.refreshError && state.staleSince !== null ? (
          <StaleNote message={strings.common.refreshFailed(formatSavedAt(state.staleSince))} onRetry={retry} />
        ) : null}
        {state.status === "ready" && spaces.length + vehicles.length === 0 ? (
          <StateMessage testID="empty" icon={ClipboardCheck} title={a.emptyTitle} body={a.empty} />
        ) : null}
        {spaces.length > 0 ? (
          <View>
            <SectionBar title={a.spaces} meta={String(spaces.length)} />
            {spaces.map((b) => {
              const item = spaceItem(b);
              return <BookingRow key={b.id} item={{ ...item, place: `${item.place} · ${a.requestedBy(b.requester_name)}` }} onPress={() => open(item)} />;
            })}
          </View>
        ) : null}
        {vehicles.length > 0 ? (
          <View>
            <SectionBar title={a.vehicles} meta={String(vehicles.length)} />
            {vehicles.map((b) => {
              const item = vehicleItem(b);
              return <BookingRow key={b.id} item={{ ...item, place: `${item.place} · ${a.requestedBy(b.requester_name)}` }} onPress={() => open(item)} />;
            })}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
