import { useRouter } from "expo-router";
import { Lock, ScanLine } from "lucide-react-native";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Banner, EmptyState, ListGroup, ListRow, SkeletonList, Text } from "@/components";
import { useMe } from "@/features/shell";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { getCheckInEvents, type CheckInEvent } from "../api";
import { TicketsScreen } from "../components/TicketsScreen";
import { formatEventWhen } from "../dates";
import { isSignedOutError } from "../hooks";
import { canRunCheckIn } from "../permissions";
import { strings } from "../strings";

type Load =
  | { state: "loading" }
  | { state: "denied" }
  | { state: "error"; message: string }
  | { state: "ready"; events: CheckInEvent[] };

export function CheckInEventsScreen() {
  const router = useRouter();
  const me = useMe();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const fetchEvents = useCallback(
    (signal?: AbortSignal) =>
      getCheckInEvents(apiFetch, { signal }).then(
        ({ events }) => setLoad({ state: "ready", events }),
        (err: unknown) => {
          if (signal?.aborted || isSignedOutError(err)) return;
          if (err instanceof ApiError && err.kind === "forbidden") setLoad({ state: "denied" });
          else setLoad({ state: "error", message: err instanceof ApiError ? err.message : "Something went wrong." });
        },
      ),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchEvents(controller.signal);
    return () => controller.abort();
  }, [fetchEvents]);

  async function refresh() {
    setRefreshing(true);
    await fetchEvents();
    setRefreshing(false);
  }

  // /api/me is UX only: if it says no, don't tease a list the server will refuse.
  const deniedByMe = me.status === "ready" && !canRunCheckIn(me.me);
  const denied = deniedByMe || load.state === "denied";

  let body: ReactNode;
  if (denied) {
    body = <EmptyState icon={Lock} title={strings.checkIn.deniedTitle} body={strings.checkIn.deniedBody} testID="empty-state" />;
  } else if (load.state === "loading") {
    body = <SkeletonList inset={false} label={strings.checkIn.listLoading} />;
  } else if (load.state === "error") {
    body = (
      <Banner
        tone="error"
        title={strings.checkIn.listErrorTitle}
        testID="error-state"
        actionLabel={strings.myTickets.retry}
        onAction={() => {
          setLoad({ state: "loading" });
          void fetchEvents();
        }}
      >
        {load.message}
      </Banner>
    );
  } else if (load.state === "ready" && load.events.length === 0) {
    body = <EmptyState icon={ScanLine} title={strings.checkIn.listEmptyTitle} body={strings.checkIn.listEmptyBody} testID="empty-state" />;
  } else if (load.state === "ready") {
    // No counts here: the tally lives on the Door page.
    body = (
      <ListGroup inset={false}>
        {load.events.map((e) => {
          const when = formatEventWhen(e);
          const where = e.location ?? strings.ticket.locationTbc;
          return (
            <ListRow
              key={e.id}
              testID={`event-${e.id}`}
              icon={ScanLine}
              title={e.title}
              accessibilityLabel={`${e.title}. ${when}. ${where}`}
              accessibilityHint={strings.checkIn.openEventHint}
              onPress={() => router.push({ pathname: "/tickets/check-in/[eventId]", params: { eventId: e.id, title: e.title } })}
            >
              <Text variant="caption" tone="secondary">
                {when}
              </Text>
              <Text variant="caption" tone="secondary">
                {where}
              </Text>
            </ListRow>
          );
        })}
      </ListGroup>
    );
  }

  return (
    <TicketsScreen
      eyebrow={strings.checkIn.context}
      title={strings.checkIn.listTitle}
      back={{ label: strings.myTickets.title, onPress: () => (router.canGoBack() ? router.back() : router.replace("/tickets")) }}
      onRefresh={denied ? undefined : () => void refresh()}
      refreshing={refreshing}
    >
      {body}
    </TicketsScreen>
  );
}
