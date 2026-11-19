import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Check, PenLine } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Alert, RefreshControl, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Banner, Button, EmptyState, LargeTitleScrollView, ListGroup, ListRow, SkeletonList, Text, type BackAction } from "@/components";
import { formatSavedAt } from "@/features/finance/cache";
import { useCachedLoad } from "@/features/finance/use-cached-load";
import { openWebPage, useMe } from "@/features/shell";
import { refreshControlColors } from "@/theme/styles";
import { hairline, space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { bookingsAccess } from "../access";
import { cancelVehicle, decideVehicle, loadErrorMessage, userMessage } from "../api";
import { bookingsFetch } from "../client";
import { DecisionSheet } from "../components/DecisionSheet";
import { QueueList } from "../components/QueueList";
import { Bleed, Field, FieldList, LoadFailed, PushedPage, SectionTitle, StaleNote, StatusLine, useAnnounceOnIOS } from "../components/ui";
import { loadVehicleBooking, type VehicleDetail } from "../data";
import { canCancel, dateRangeLabel, dayCount, purposeLabel, vehicleNames, type InspectionKind } from "../logic";
import { goBackTo } from "../nav";
import { useBookingsOutbox } from "../outbox/provider";
import { forBooking, formQueued } from "../outbox/state";
import { strings } from "../strings";
import type { Inspection } from "../types";

const d = strings.detail;

/** Whether the collection / return check can be recorded from the phone. */
export function checkState(
  kind: InspectionKind,
  inspections: Inspection[],
  queued: boolean,
  opts: { status: string; mayInspect: boolean },
): { recorded: Inspection | null; canRecord: boolean } {
  const recorded = inspections.find((i) => i.kind === kind) ?? null;
  // The web lets the requester or a manager record each check once (a second
  // one is refused with 409). The app also waits for approval: a check on a
  // request nobody has approved isn't something anyone collects against.
  const live = opts.status === "approved" || opts.status === "completed";
  return { recorded, canRecord: opts.mayInspect && live && !recorded && !queued };
}

// A vehicle booking (frames 7.4, 7.10, 7.14): status, the details, the
// drivers with their driving-test status, Approve / Decline for approvers,
// then the collection and return checks with whatever is still saved on this
// phone, and Cancel.
export default function VehicleDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const me = useMe();
  const access = useMemo(() => bookingsAccess(me.me), [me.me]);
  const { items, outbox, online } = useBookingsOutbox();
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Approved" / "Cancelled" / a failure appear in a banner; Android reads
  // its live region, iOS needs them spoken.
  // A danger Banner speaks itself on iOS; only the positive result needs a nudge.
  useAnnounceOnIOS(actionError ? null : done);

  const load = useCallback(() => loadVehicleBooking(id), [id]);
  const { state, refreshing, refresh, retry } = useCachedLoad<VehicleDetail | null>({
    userId,
    cacheName: `bookings.vehicle.${id}`,
    load,
    errorMessage: loadErrorMessage,
  });

  const back: BackAction = { label: strings.common.bookings, onPress: () => goBackTo(router, "/bookings") };

  if (state.status === "loading") {
    return (
      <PushedPage back={back}>
        <SkeletonList label={d.loading} count={5} inset={false} />
      </PushedPage>
    );
  }
  if (state.status === "error") {
    return (
      <PushedPage back={back}>
        <LoadFailed title={d.vehicleContext} message={state.message} onRetry={retry} />
      </PushedPage>
    );
  }
  if (!state.data) {
    return (
      <PushedPage back={back}>
        <EmptyState testID="not-found" title={d.vehicleContext} body={strings.common.notFound} />
      </PushedPage>
    );
  }

  const { booking: b, inspections } = state.data;
  const isOwner = b.requested_by === userId;
  const isManager = access.vehicles.manage;
  const canDecide = access.vehicles.approve && b.status === "pending";
  const cancellable = canCancel(b.status, isOwner, isManager);
  const mayInspect = isOwner || isManager;
  const queue = forBooking(items, b.id, userId);
  const days = dayCount(b.checkout_date, b.return_date);

  async function decide(note: string): Promise<string | null> {
    if (!decision) return null;
    try {
      await decideVehicle(bookingsFetch, b.id, decision, note);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(decision === "approved" ? strings.decision.approved : strings.decision.declined);
      setDecision(null);
      void refresh();
      return null;
    } catch (err) {
      // e.g. "Can't approve — Sam has no licence photo on this booking."
      return userMessage(err);
    }
  }

  async function cancel() {
    setBusy(true);
    setActionError(null);
    try {
      await cancelVehicle(bookingsFetch, b.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(d.cancelled);
      void refresh();
    } catch (err) {
      setActionError(userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmCancel() {
    Alert.alert(d.cancelConfirmTitle, d.cancelConfirmBody, [
      { text: d.keep, style: "cancel" },
      { text: d.cancelYes, style: "destructive", onPress: () => void cancel() },
    ]);
  }

  const showChecks = mayInspect && (b.status === "approved" || b.status === "completed");

  return (
    <>
      <LargeTitleScrollView
        back={back}
        eyebrow={d.vehicleContext}
        title={b.booking_name}
        gap={0}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} {...refreshControlColors(colors)} />}
      >
        <View style={{ flexDirection: "row", marginTop: -space.sm }}>
          <StatusLine status={b.status} />
        </View>
        <Bleed style={{ gap: space.md, marginTop: space.md }}>
          {state.refreshError && state.staleSince !== null ? <StaleNote message={strings.common.refreshFailed(formatSavedAt(state.staleSince))} onRetry={retry} /> : null}
          {done ? (
            <Banner tone="positive" testID="done">
              {done}
            </Banner>
          ) : null}
        </Bleed>

        <View style={{ marginTop: space.md }}>
          <FieldList>
            <Field label={d.dates} value={`${dateRangeLabel(b.checkout_date, b.return_date)} · ${d.days(days)}`} />
            <Field label={d.vehicles} value={vehicleNames(b)} />
            <Field label={d.purpose} value={b.purpose === "other" && b.purpose_note ? b.purpose_note : purposeLabel(b.purpose)} />
            <Field label={d.destination} value={b.destination} />
            <Field label={d.pointPerson} value={b.point_person} />
            <Field label={d.requestedBy} value={b.requester_name} />
            <Field label={d.whatsapp} value={b.requester_phone} />
            <Field label={d.people} value={b.num_people != null ? String(b.num_people) : null} />
            <Field label={d.notes} value={b.notes} />
            <Field label={d.decisionNote} value={b.decision_note} />
          </FieldList>
        </View>

        <View>
          <SectionTitle title={d.drivers} meta={String(b.drivers.length)} />
          {b.drivers.length === 0 ? <Text tone="secondary">{d.noDrivers}</Text> : null}
          {b.drivers.map((dr, i) => (
            <View key={dr.id} accessible style={{ paddingVertical: 10, gap: 2, borderTopWidth: i > 0 ? hairline : 0, borderTopColor: colors.rule }}>
              <Text variant="rowTitle">{dr.name}</Text>
              <Text variant="caption" tone="secondary">
                {d.driverTest[dr.driving_test_status]}
              </Text>
              {/* Outside drivers carry their documents on the booking itself. */}
              {!dr.user_id ? (
                <Text variant="caption" tone={dr.license_file_url && dr.passport_file_url ? "secondary" : "danger"}>
                  {d.outsiderDocs(!!dr.license_file_url, !!dr.passport_file_url)}
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        {canDecide ? (
          <View>
            <SectionTitle title={d.decisionTitle} />
            <View style={{ gap: space.md }}>
              <Text tone="secondary">{strings.decision.licenceHint}</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button label={d.approve} onPress={() => setDecision("approved")} style={{ flex: 1 }} testID="approve" />
                <Button label={d.decline} variant="danger" onPress={() => setDecision("denied")} style={{ flex: 1 }} testID="decline" />
              </View>
              {isManager ? (
                <Bleed>
                  <ListGroup inset={false}>
                    <ListRow title={d.assignOnWeb} trailing="web" onPress={() => void openWebPage(`/bookings/vehicles/${b.id}`, colors)} />
                  </ListGroup>
                </Bleed>
              ) : null}
            </View>
          </View>
        ) : null}

        {showChecks ? (
          <View>
            <SectionTitle title={d.checksTitle} />
            {(["collection", "return"] as const).map((kind) => {
              const queued = formQueued(items, b.id, kind, userId);
              const c = checkState(kind, inspections, queued, { status: b.status, mayInspect });
              const label = kind === "collection" ? d.collectionLabel : d.returnLabel;
              return (
                <View key={kind} style={{ gap: 2, paddingVertical: space.sm, borderTopWidth: hairline, borderTopColor: colors.rule }} testID={`check-${kind}`}>
                  <Text variant="rowTitle" accessibilityRole="header">
                    {label}
                  </Text>
                  <Text tone="secondary">
                    {c.recorded ? d.checkRecorded(c.recorded.performed_at.slice(0, 10), c.recorded.mileage) : queued ? d.checkQueued : d.checkNotRecorded}
                  </Text>
                  {c.canRecord ? (
                    <Button
                      label={kind === "collection" ? d.recordCollection : d.recordReturn}
                      variant="secondary"
                      icon={<Check size={20} color={colors.text} />}
                      onPress={() => router.push({ pathname: "/bookings/vehicle/[id]/[kind]", params: { id: b.id, kind } })}
                      style={{ marginTop: space.sm }}
                      testID={`record-${kind}`}
                    />
                  ) : null}
                </View>
              );
            })}
            <Bleed style={{ gap: space.md, marginTop: space.sm }}>
              <QueueList items={queue} outbox={outbox} online={online} />
              <ListGroup inset={false}>
                <ListRow icon={PenLine} title={d.agreement} subtitle={d.agreementSub} trailing="web" onPress={() => void openWebPage(`/bookings/vehicles/${b.id}/agreement`, colors)} />
              </ListGroup>
            </Bleed>
          </View>
        ) : null}

        {cancellable ? (
          <View style={{ gap: space.sm, marginTop: showChecks ? space.md : space.xl }}>
            {actionError ? (
              <Bleed>
                <Banner tone="error" testID="action-error">
                  {actionError}
                </Banner>
              </Bleed>
            ) : null}
            <Button label={d.cancel} variant="secondary" loading={busy} onPress={confirmCancel} testID="cancel" />
          </View>
        ) : null}
      </LargeTitleScrollView>
      <DecisionSheet key={decision ?? "closed"} decision={decision} onClose={() => setDecision(null)} onConfirm={(note) => decide(note)} hint={strings.decision.licenceHint} />
    </>
  );
}
