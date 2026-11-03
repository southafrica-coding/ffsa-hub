import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, Masthead, Screen, Text } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { ErrorState, SectionBar, Skeleton, StaleNote } from "@/features/finance/components/ui";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { StateMessage, useMe } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { useTheme } from "@/theme/use-theme";

import { bookingsAccess } from "../access";
import { cancelSpace, checkSpace, decideSpace, loadErrorMessage, userMessage } from "../api";
import { bookingsFetch } from "../client";
import { ConflictList } from "../components/ConflictList";
import { DecisionSheet } from "../components/DecisionSheet";
import { Field, StatusLine, useAnnounceOnIOS } from "../components/ui";
import { loadSpaceBooking } from "../data";
import { canCancel, dateRangeLabel, EMPTY_SPACE, hm, timeRangeLabel } from "../logic";
import { strings } from "../strings";
import type { Conflict, SpaceBooking } from "../types";

const d = strings.detail;

/** Clashes with OTHER bookings, from the same server check the form uses. */
function useClashes(b: SpaceBooking | null, enabled: boolean): { status: "idle" | "checking" | "done"; conflicts: Conflict[] } {
  const [answer, setAnswer] = useState<{ booking: SpaceBooking; conflicts: Conflict[] | null } | null>(null);
  useEffect(() => {
    if (!b || !enabled) return;
    const ctrl = new AbortController();
    checkSpace(
      bookingsFetch,
      {
        ...EMPTY_SPACE,
        venueId: b.venue_id,
        date: b.booking_date,
        endDate: b.end_date ?? "",
        startTime: hm(b.start_time) ?? "",
        endTime: hm(b.end_time) ?? "",
        setupTime: hm(b.setup_time) ?? "",
        setdownTime: hm(b.setdown_time) ?? "",
        title: b.title,
      },
      { signal: ctrl.signal },
    ).then(
      // The request itself is pending, so the check finds it too: drop it.
      (r) => setAnswer({ booking: b, conflicts: r.conflicts.filter((c) => c.existingId !== b.id) }),
      () => {
        if (!ctrl.signal.aborted) setAnswer({ booking: b, conflicts: null });
      },
    );
    return () => ctrl.abort();
  }, [b, enabled]);
  if (!b || !enabled) return { status: "idle", conflicts: [] };
  if (answer?.booking !== b) return { status: "checking", conflicts: [] };
  // A failed check is shown as nothing rather than a false "no clashes".
  return answer.conflicts ? { status: "done", conflicts: answer.conflicts } : { status: "idle", conflicts: [] };
}

export default function SpaceDetailScreen({ id }: { id: string }) {
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const me = useMe();
  const access = useMemo(() => bookingsAccess(me.me), [me.me]);
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Approved" / "Cancelled" / a failure appear in a banner; Android reads
  // its live region, iOS needs them spoken.
  // A danger Banner speaks itself on iOS; only the positive result needs a nudge.
  useAnnounceOnIOS(actionError ? null : done);

  const load = useCallback(() => loadSpaceBooking(id), [id]);
  const { state, refreshing, refresh, retry } = useCachedLoad<SpaceBooking | null>({
    userId,
    cacheName: `bookings.space.${id}`,
    load,
    errorMessage: loadErrorMessage,
  });

  const b = state.status === "ready" ? state.data : null;
  const canDecide = !!b && access.spaces.approve && b.status === "pending";
  const clashes = useClashes(b, canDecide);

  if (state.status === "loading") {
    return (
      <Screen edges={[]}>
        <Skeleton label={d.loading} />
      </Screen>
    );
  }
  if (state.status === "error") {
    return (
      <Screen edges={[]}>
        <ErrorState title={d.spaceContext} message={state.message} onRetry={retry} />
      </Screen>
    );
  }
  if (!b) {
    return (
      <Screen edges={[]}>
        <StateMessage testID="not-found" title={d.spaceContext} body={strings.common.notFound} />
      </Screen>
    );
  }

  const isOwner = b.requested_by === userId;
  const cancellable = canCancel(b.status, isOwner, access.spaces.manage);

  async function decide(note: string, applyToSeries: boolean): Promise<string | null> {
    if (!decision || !b) return null;
    try {
      await decideSpace(bookingsFetch, b.id, decision, note, applyToSeries && !!b.series_id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(decision === "approved" ? strings.decision.approved : strings.decision.declined);
      setDecision(null);
      void refresh();
      return null;
    } catch (err) {
      return userMessage(err);
    }
  }

  async function cancel(wholeSeries: boolean) {
    if (!b) return;
    setBusy(true);
    setActionError(null);
    try {
      await cancelSpace(bookingsFetch, b.id, wholeSeries);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(wholeSeries ? d.seriesCancelled : d.cancelled);
      void refresh();
    } catch (err) {
      setActionError(userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmCancel(wholeSeries: boolean) {
    Alert.alert(wholeSeries ? d.cancelSeriesConfirmTitle : d.cancelConfirmTitle, wholeSeries ? d.cancelSeriesConfirmBody : d.cancelConfirmBody, [
      { text: d.keep, style: "cancel" },
      { text: d.cancelYes, style: "destructive", onPress: () => void cancel(wholeSeries) },
    ]);
  }

  const multiDay = !!b.end_date && b.end_date > b.booking_date;

  return (
    <Screen scroll={false} edges={[]} contentStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        <Masthead context={d.spaceContext} title={b.title} />
        <StatusLine status={b.status} />
        {state.refreshError && state.staleSince !== null ? <StaleNote message={strings.common.refreshFailed(formatSavedAt(state.staleSince))} onRetry={retry} /> : null}
        {done ? (
          <Banner tone="positive" testID="done">
            {done}
          </Banner>
        ) : null}

        <View>
          <Field label={d.where} value={[b.venue?.name, b.venue?.building].filter(Boolean).join(" · ")} />
          <Field label={d.dates} value={dateRangeLabel(b.booking_date, b.end_date)} />
          <Field label={d.times} value={multiDay ? null : timeRangeLabel(b.start_time, b.end_time)} />
          <Field label={d.setup} value={multiDay ? null : hm(b.setup_time)} />
          <Field label={d.setdown} value={multiDay ? null : hm(b.setdown_time)} />
          <Field label={d.ministry} value={b.ministry?.name} />
          <Field label={d.pointPerson} value={b.point_person} />
          <Field label={d.requestedBy} value={b.requester_name} />
          <Field label={d.description} value={b.description} />
          <Field label={d.decisionNote} value={b.decision_note} />
          {b.series_id ? <Text tone="secondary">{d.repeats}</Text> : null}
        </View>

        {canDecide ? (
          <View style={{ gap: 12 }}>
            <SectionBar title={d.decisionTitle} />
            {clashes.status === "checking" ? <Text tone="secondary">{d.clashChecking}</Text> : null}
            {clashes.status === "done" && clashes.conflicts.length === 0 ? <Text tone="secondary">{d.noClash}</Text> : null}
            <ConflictList conflicts={clashes.conflicts} blocked={false} title={d.clashTitle} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button label={d.approve} onPress={() => setDecision("approved")} style={{ flex: 1 }} testID="approve" />
              <Button label={d.decline} variant="destructive" onPress={() => setDecision("denied")} style={{ flex: 1 }} testID="decline" />
            </View>
          </View>
        ) : null}

        {cancellable ? (
          <View style={{ gap: 8 }}>
            {actionError ? (
              <Banner tone="danger" testID="action-error">
                {actionError}
              </Banner>
            ) : null}
            <Button label={d.cancel} variant="secondary" loading={busy} onPress={() => confirmCancel(false)} testID="cancel" />
            {b.series_id ? <Button label={d.cancelSeries} variant="ghost" disabled={busy} onPress={() => confirmCancel(true)} testID="cancel-series" /> : null}
          </View>
        ) : null}
      </ScrollView>
      <DecisionSheet key={decision ?? "closed"} decision={decision} onClose={() => setDecision(null)} onConfirm={decide} seriesOption={!!b.series_id} />
    </Screen>
  );
}
