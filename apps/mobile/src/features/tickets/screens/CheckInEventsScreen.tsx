import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Masthead, Text } from "@/components";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { hairline, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { getCheckInEvents, type CheckInEvent } from "../api";
import { EmptyState, ErrorState, SkeletonRows } from "../components/StateViews";
import { TicketsScreen } from "../components/TicketsScreen";
import { formatEventWhen } from "../dates";
import { isSignedOutError, useMe } from "../hooks";
import { canRunCheckIn } from "../permissions";
import { strings } from "../strings";

type Load =
  | { state: "loading" }
  | { state: "denied" }
  | { state: "error"; message: string }
  | { state: "ready"; events: CheckInEvent[] };

export function CheckInEventsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
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
    body = <EmptyState title={strings.checkIn.deniedTitle} body={strings.checkIn.deniedBody} />;
  } else if (load.state === "loading") {
    body = <SkeletonRows label={strings.checkIn.listLoading} />;
  } else if (load.state === "error") {
    body = (
      <ErrorState
        title={strings.checkIn.listErrorTitle}
        message={load.message}
        onRetry={() => {
          setLoad({ state: "loading" });
          void fetchEvents();
        }}
      />
    );
  } else if (load.state === "ready" && load.events.length === 0) {
    body = <EmptyState title={strings.checkIn.listEmptyTitle} body={strings.checkIn.listEmptyBody} />;
  } else if (load.state === "ready") {
    body = (
      <View>
        {load.events.map((e) => {
          const when = formatEventWhen(e);
          const where = e.location ?? strings.ticket.locationTbc;
          return (
            <Pressable
              key={e.id}
              testID={`event-${e.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${e.title}. ${when}. ${where}`}
              accessibilityHint={strings.checkIn.openEventHint}
              onPress={() => router.push({ pathname: "/tickets/check-in/[eventId]", params: { eventId: e.id, title: e.title } })}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: touch.minTarget + 16,
                paddingVertical: 12,
                borderBottomWidth: hairline,
                borderBottomColor: colors.rule,
                backgroundColor: pressed ? colors.surface : "transparent",
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{e.title}</Text>
                <Text variant="caption" tone="secondary">
                  {when}
                </Text>
                <Text variant="caption" tone="secondary">
                  {where}
                </Text>
              </View>
              <ChevronRight size={20} color={colors.textSecondary} accessibilityElementsHidden importantForAccessibility="no" />
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <TicketsScreen onRefresh={denied ? undefined : () => void refresh()} refreshing={refreshing}>
      <Masthead context={strings.checkIn.context} title={strings.checkIn.listTitle} />
      {body}
    </TicketsScreen>
  );
}
