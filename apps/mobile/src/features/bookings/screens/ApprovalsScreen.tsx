import { useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import { useCallback, useMemo, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { EmptyState, LargeTitleScrollView, ListGroup, SkeletonList, type BackAction } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { useMe } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { bookingsAccess } from "../access";
import { loadErrorMessage } from "../api";
import { Bleed, BookingRow, LoadFailed, SectionTitle, StaleNote } from "../components/ui";
import { loadPending, type Pending } from "../data";
import { spaceItem, vehicleItem, type BookingItem } from "../logic";
import { goBackTo } from "../nav";
import { strings } from "../strings";

const a = strings.approvals;

// "Waiting for you" (frame 7.6): every pending space and vehicle request this
// person may decide, soonest first (the web's two request queues). No yellow
// band: the whole screen is the queue, so a band would point at itself.
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

  const back: BackAction = { label: strings.common.bookings, onPress: () => goBackTo(router, "/bookings") };
  const page = (children: ReactNode, refreshable = false) => (
    <LargeTitleScrollView
      back={back}
      eyebrow={a.context}
      title={a.title}
      gap={0}
      refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} /> : undefined}
    >
      {children}
    </LargeTitleScrollView>
  );

  if (me.status === "loading") {
    return page(
      <Bleed>
        <SkeletonList label={a.loading} count={4} inset={false} />
      </Bleed>,
    );
  }
  if (!access.approver) {
    return page(
      <Bleed>
        <EmptyState testID="no-access" title={a.noAccessTitle} body={a.noAccessBody} />
      </Bleed>,
    );
  }

  function open(i: BookingItem) {
    router.push({ pathname: i.kind === "space" ? "/bookings/space/[id]" : "/bookings/vehicle/[id]", params: { id: i.id } });
  }

  const spaces = state.status === "ready" ? state.data.spaces : [];
  const vehicles = state.status === "ready" ? state.data.vehicles : [];

  return page(
    <>
      <Bleed style={{ gap: space.md }}>
        {state.status === "loading" ? <SkeletonList label={a.loading} count={4} inset={false} /> : null}
        {state.status === "error" ? <LoadFailed title={a.title} message={state.message} onRetry={retry} /> : null}
        {state.status === "ready" && state.refreshError && state.staleSince !== null ? (
          <StaleNote message={strings.common.refreshFailed(formatSavedAt(state.staleSince))} onRetry={retry} />
        ) : null}
        {state.status === "ready" && spaces.length + vehicles.length === 0 ? <EmptyState testID="empty" icon={Check} title={a.emptyTitle} body={a.empty} /> : null}
      </Bleed>
      {spaces.length > 0 ? (
        <View>
          <SectionTitle title={a.spaces} meta={String(spaces.length)} />
          <Bleed>
            <ListGroup inset={false}>
              {spaces.map((b) => {
                const item = spaceItem(b);
                return <BookingRow key={b.id} item={{ ...item, place: `${item.place} · ${a.requestedBy(b.requester_name)}` }} onPress={() => open(item)} />;
              })}
            </ListGroup>
          </Bleed>
        </View>
      ) : null}
      {vehicles.length > 0 ? (
        <View>
          <SectionTitle title={a.vehicles} meta={String(vehicles.length)} />
          <Bleed>
            <ListGroup inset={false}>
              {vehicles.map((b) => {
                const item = vehicleItem(b);
                return <BookingRow key={b.id} item={{ ...item, place: `${item.place} · ${a.requestedBy(b.requester_name)}` }} onPress={() => open(item)} />;
              })}
            </ListGroup>
          </Bleed>
        </View>
      ) : null}
    </>,
    true,
  );
}
