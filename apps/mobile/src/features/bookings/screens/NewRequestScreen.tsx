import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Building2, Car, Music } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "@/auth/session-provider";
import { Button, EmptyState, LargeTitle, ListGroup, ListRow, SkeletonList, Text } from "@/components";
import { openWebPage, useMe } from "@/features/shell";
import { announce } from "@/lib/a11y";
import { hairline, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { bookingsAccess } from "../access";
import { listPeople, submitSpace, submitVehicle, userMessage } from "../api";
import { bookingsFetch } from "../client";
import { Bleed, FormError, LoadFailed } from "../components/ui";
import { loadSpaceOptions, loadVehicles, type SpaceOptions } from "../data";
import { back, chooseKind, next, progress, type FlowState, type RequestKind } from "../flow";
import { EMPTY_SPACE, EMPTY_VEHICLE } from "../logic";
import { goBackTo } from "../nav";
import { strings } from "../strings";
import type { Conflict, Person, Vehicle } from "../types";

import { SpaceChoice, SpaceDetails, SpaceReview, SpaceWhen, useSpaceCheck, type SpaceCheckState } from "./SpaceSteps";
import { useVehicleAvailability, VehicleChoice, VehicleDetails, VehicleDrivers, VehicleReview, VehicleWhen } from "./VehicleSteps";

type Load<T> = { status: "loading" | "ready" | "error"; data: T | null; message: string | null; retry: () => void };

/** Load once when `enabled` turns on; retry on demand. */
function useLoad<T>(fn: () => Promise<T>, enabled: boolean): Load<T> {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ attempt: number; data: T | null; message: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fn().then(
      (data) => alive && setAnswer({ attempt, data, message: null }),
      (err: unknown) => alive && setAnswer({ attempt, data: null, message: userMessage(err) }),
    );
    return () => {
      alive = false;
    };
  }, [fn, enabled, attempt]);
  const retry = useCallback(() => setAttempt((x) => x + 1), []);
  if (!answer || answer.attempt !== attempt) return { status: "loading", data: null, message: null, retry };
  return { status: answer.message ? "error" : "ready", data: answer.data, message: answer.message, retry };
}

const st = strings.steps;

/** One bar per step, filled up to the current one. Decoration: the eyebrow says "Step 3 of 5". */
function StepProgress({ index, total }: { index: number; total: number }) {
  const { colors } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="step-progress" style={{ flexDirection: "row", gap: 6, marginBottom: space.xs }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < index ? colors.text : colors.rule }} />
      ))}
    </View>
  );
}

/**
 * The full-height form page (frames 7.2, 7.3, 7.7–7.9): Cancel and the step
 * bars on top, the step in a scroll view, Back / Next pinned under it. The
 * tab bar is hidden on this route.
 */
function FormPage({ onCancel, progress: bars, footer, step, children }: { onCancel: () => void; progress?: ReactNode; footer?: ReactNode; step: string; children: ReactNode }) {
  const { colors } = useTheme();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  // A new step starts at its top.
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [step]);
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingHorizontal: space.gutter }}>
          <View style={{ minHeight: touch.floor, flexDirection: "row", alignItems: "center", marginHorizontal: -space.sm }}>
            <Button label={strings.common.cancel} variant="ghost" onPress={onCancel} testID="cancel-request" />
          </View>
          {bars}
        </View>
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xl, gap: space.lg }}>
          {children}
        </ScrollView>
        {footer ? (
          <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.gutter, paddingTop: 10, paddingBottom: space.md, borderTopWidth: hairline, borderTopColor: colors.rule, backgroundColor: colors.bg }}>
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// New request: a step at a time. Space: type → space → when → details →
// review. Vehicle: type → dates → vehicle → drivers → details → review.
// Clash and availability answers come from the server's own checks.
export default function NewRequestScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const me = useMe();
  const access = useMemo(() => bookingsAccess(me.me), [me.me]);

  const fullName = [me.me?.profile?.firstName, me.me?.profile?.lastName].filter(Boolean).join(" ");
  const [flow, setFlow] = useState<FlowState>(() => ({
    kind: null,
    step: "type",
    space: { ...EMPTY_SPACE, requesterName: fullName },
    vehicle: { ...EMPTY_VEHICLE, requesterName: fullName, requesterEmail: me.me?.user.email ?? "" },
  }));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [blocked, setBlocked] = useState<{ message: string; conflicts: Conflict[] } | null>(null);

  const isSpace = flow.kind === "space";
  const isVehicle = flow.kind === "vehicle";
  const spaceOptions = useLoad<SpaceOptions>(loadSpaceOptions, isSpace);
  const fleet = useLoad<Vehicle[]>(loadVehicles, isVehicle);
  const peopleFn = useCallback(() => listPeople(bookingsFetch), []);
  const people = useLoad<Person[]>(peopleFn, isVehicle);

  const spaceCheck = useSpaceCheck(flow.space, isSpace && (flow.step === "when" || flow.step === "review"));
  const availability = useVehicleAvailability(flow.vehicle);

  const setSpace = (p: Partial<FlowState["space"]>) => {
    setFlow((f) => ({ ...f, space: { ...f.space, ...p } }));
    setError(null);
    setBlocked(null);
  };
  const setVehicle = (p: Partial<FlowState["vehicle"]>) => {
    setFlow((f) => ({ ...f, vehicle: { ...f.vehicle, ...p } }));
    setError(null);
  };

  // A new step replaces the screen's content under the same Next button, so
  // screen-reader focus doesn't move: say where the person is now. Until a
  // kind is chosen there are no steps to count, so the eyebrow says what this is.
  const stepNow = progress(flow);
  const eyebrow = flow.kind ? st.of(stepNow.index, stepNow.total) : strings.home.newRequest;
  const stepSpoken = strings.a11y.stepChanged(eyebrow, st.titles[flow.step]);
  const lastStep = useRef(flow.step);
  useEffect(() => {
    if (flow.step === lastStep.current) return;
    lastStep.current = flow.step;
    announce(stepSpoken);
  }, [flow.step, stepSpoken]);

  const close = () => goBackTo(router, "/bookings");

  if (me.status === "loading") {
    return (
      <FormPage onCancel={close} step="loading">
        <Bleed>
          <SkeletonList label={strings.common.loading} count={3} inset={false} />
        </Bleed>
      </FormPage>
    );
  }
  const canSpace = access.spaces.request;
  const canVehicle = access.vehicles.request;

  const { index, total } = progress(flow);
  const ctx = { unavailableVehicleIds: availability.unavailable, people: people.data ?? [] };
  const effectiveCheck: SpaceCheckState = blocked
    ? { status: "done", result: { ok: true, conflicts: blocked.conflicts, autoConfirm: true, blocked: true }, message: null }
    : spaceCheck;
  const spaceBlocked = isSpace && effectiveCheck.status === "done" && !!effectiveCheck.result?.blocked;
  const spaceClashes = isSpace && effectiveCheck.status === "done" ? (effectiveCheck.result?.conflicts.length ?? 0) : 0;

  function goNext() {
    if (isSpace && flow.step === "when" && spaceBlocked) {
      setError(strings.clash.changeToContinue);
      return;
    }
    const r = next(flow, ctx);
    setError(r.error);
    setFlow(r.state);
  }

  function goBack() {
    const prev = back(flow);
    setError(null);
    if (prev) setFlow(prev);
    else close();
  }

  function pick(kind: RequestKind) {
    setFlow((f) => next(chooseKind(f, kind), ctx).state);
    setError(null);
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      if (isSpace) {
        const r = await submitSpace(bookingsFetch, flow.space);
        if (r.kind === "blocked") {
          setBlocked({ message: r.message, conflicts: r.conflicts });
          setError(r.message);
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        announce(r.autoConfirm ? strings.review.sentSpaceConfirmed : strings.review.sentSpacePending);
        if (r.bookingId) router.replace({ pathname: "/bookings/space/[id]", params: { id: r.bookingId } });
        else router.replace("/bookings");
      } else {
        const r = await submitVehicle(bookingsFetch, flow.vehicle);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        announce(strings.review.sentVehicle);
        router.replace({ pathname: "/bookings/vehicle/[id]", params: { id: r.bookingId } });
      }
    } catch (err) {
      // The server's own words: "Sam cannot be added as a driver — Licence expired…"
      setError(userMessage(err));
    } finally {
      setSending(false);
    }
  }

  const submitLabel = isSpace
    ? spaceBlocked
      ? strings.review.blocked
      : spaceClashes > 0
        ? st.submitAnyway
        : effectiveCheck.result?.autoConfirm
          ? st.confirm
          : st.submit
    : st.submit;

  function body() {
    switch (flow.step) {
      case "type":
        if (!canSpace && !canVehicle && !access.equipment.view) {
          return (
            <Bleed>
              <EmptyState testID="no-request" title={st.titles.type} body={strings.type.noneAllowed} />
            </Bleed>
          );
        }
        // Rows only for what this account may ask for; equipment opens the website.
        return (
          <>
            <Bleed>
              <ListGroup inset={false}>
                {canSpace ? <ListRow icon={Building2} title={strings.type.space} subtitle={strings.type.spaceSub} onPress={() => pick("space")} testID="type-space" /> : null}
                {canVehicle ? <ListRow icon={Car} title={strings.type.vehicle} subtitle={strings.type.vehicleSub} onPress={() => pick("vehicle")} testID="type-vehicle" /> : null}
                {access.equipment.view ? (
                  <ListRow icon={Music} title={strings.type.equipment} subtitle={strings.type.equipmentNotYet} trailing="web" onPress={() => void openWebPage("/bookings/equipment", colors)} testID="type-equipment" />
                ) : null}
              </ListGroup>
            </Bleed>
            {!canSpace && !canVehicle ? <Text tone="secondary">{strings.type.noneAllowed}</Text> : null}
          </>
        );
      case "space":
        if (spaceOptions.status === "loading") {
          return (
            <Bleed>
              <SkeletonList label={strings.space.loading} count={3} inset={false} />
            </Bleed>
          );
        }
        if (spaceOptions.status === "error" || !spaceOptions.data) {
          return (
            <Bleed>
              <LoadFailed title={st.titles.space} message={spaceOptions.message ?? strings.common.generic} onRetry={spaceOptions.retry} />
            </Bleed>
          );
        }
        return <SpaceChoice options={spaceOptions.data} f={flow.space} set={setSpace} canApprove={access.spaces.approve} />;
      case "when":
        return isSpace ? <SpaceWhen f={flow.space} set={setSpace} check={effectiveCheck} /> : <VehicleWhen f={flow.vehicle} set={setVehicle} />;
      case "vehicle":
        if (fleet.status === "loading") {
          return (
            <Bleed>
              <SkeletonList label={strings.vehicle.loading} count={3} inset={false} />
            </Bleed>
          );
        }
        if (fleet.status === "error" || !fleet.data) {
          return (
            <Bleed>
              <LoadFailed title={st.titles.vehicle} message={fleet.message ?? strings.common.generic} onRetry={fleet.retry} />
            </Bleed>
          );
        }
        return <VehicleChoice fleet={fleet.data} f={flow.vehicle} set={setVehicle} check={availability} />;
      case "drivers":
        return <VehicleDrivers people={people.data ?? []} peopleState={people.status} meId={userId} f={flow.vehicle} set={setVehicle} onRetryPeople={people.retry} />;
      case "details":
        return isSpace && spaceOptions.data ? <SpaceDetails options={spaceOptions.data} f={flow.space} set={setSpace} /> : <VehicleDetails f={flow.vehicle} set={setVehicle} />;
      case "review":
        return isSpace && spaceOptions.data ? <SpaceReview options={spaceOptions.data} f={flow.space} check={effectiveCheck} /> : <VehicleReview fleet={fleet.data ?? []} f={flow.vehicle} />;
    }
  }

  const onReview = flow.step === "review";
  // A blocked time can't go further: Next is off, with the reason under the clash.
  const whenBlocked = isSpace && flow.step === "when" && spaceBlocked;
  return (
    <FormPage
      onCancel={close}
      step={flow.step}
      progress={flow.kind ? <StepProgress index={index} total={total} /> : null}
      footer={
        flow.step !== "type" ? (
          <>
            <Button label={st.back} variant="secondary" onPress={goBack} style={{ flex: 1 }} testID="step-back" />
            {onReview ? (
              <Button label={sending ? st.sending : submitLabel} loading={sending} disabled={spaceBlocked} onPress={() => void send()} style={{ flex: 2 }} testID="submit" />
            ) : (
              <Button label={flow.step === "details" ? st.review : st.next} disabled={whenBlocked} onPress={goNext} style={{ flex: 2 }} testID="step-next" />
            )}
          </>
        ) : null
      }
    >
      <View accessible accessibilityRole="header" accessibilityLabel={stepSpoken}>
        <LargeTitle eyebrow={eyebrow} title={st.titles[flow.step]} style={{ marginBottom: -space.lg }} />
      </View>
      {body()}
      <FormError message={error ?? (whenBlocked ? strings.clash.changeToContinue : null)} />
    </FormPage>
  );
}
