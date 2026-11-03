import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Building2, Car, Speaker } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { Button, Masthead, Screen, Text } from "@/components";
import { ErrorState, Skeleton } from "@/features/finance/components/ui";
import { ListRow, StateMessage, openWebPage, useMe } from "@/features/shell";
import { useTheme } from "@/theme/use-theme";

import { bookingsAccess } from "../access";
import { listPeople, submitSpace, submitVehicle, userMessage } from "../api";
import { bookingsFetch } from "../client";
import { FormError } from "../components/ui";
import { loadSpaceOptions, loadVehicles, type SpaceOptions } from "../data";
import { back, chooseKind, next, progress, type FlowState, type RequestKind } from "../flow";
import { EMPTY_SPACE, EMPTY_VEHICLE } from "../logic";
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

  if (me.status === "loading") {
    return (
      <Screen edges={[]}>
        <Skeleton label={strings.common.loading} />
      </Screen>
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
    else router.back();
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
        if (r.bookingId) router.replace({ pathname: "/bookings/space/[id]", params: { id: r.bookingId } });
        else router.replace("/bookings");
      } else {
        const r = await submitVehicle(bookingsFetch, flow.vehicle);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
        if (!canSpace && !canVehicle && !access.equipment.view) return <StateMessage testID="no-request" title={st.titles.type} body={strings.type.noneAllowed} />;
        return (
          <View>
            {canSpace ? <ListRow icon={Building2} title={strings.type.space} subtitle={strings.type.spaceSub} onPress={() => pick("space")} testID="type-space" /> : null}
            {canVehicle ? <ListRow icon={Car} title={strings.type.vehicle} subtitle={strings.type.vehicleSub} onPress={() => pick("vehicle")} testID="type-vehicle" /> : null}
            {access.equipment.view ? (
              <ListRow icon={Speaker} title={strings.type.equipment} subtitle={strings.type.equipmentNotYet} trailing="web" onPress={() => void openWebPage("/bookings/equipment", colors)} testID="type-equipment" />
            ) : null}
            {!canSpace && !canVehicle ? <Text tone="secondary">{strings.type.noneAllowed}</Text> : null}
          </View>
        );
      case "space":
        if (spaceOptions.status === "loading") return <Skeleton label={strings.space.loading} />;
        if (spaceOptions.status === "error" || !spaceOptions.data) return <ErrorState title={st.titles.space} message={spaceOptions.message ?? strings.common.generic} onRetry={spaceOptions.retry} />;
        return <SpaceChoice options={spaceOptions.data} f={flow.space} set={setSpace} canApprove={access.spaces.approve} />;
      case "when":
        return isSpace ? <SpaceWhen f={flow.space} set={setSpace} check={effectiveCheck} /> : <VehicleWhen f={flow.vehicle} set={setVehicle} />;
      case "vehicle":
        if (fleet.status === "loading") return <Skeleton label={strings.vehicle.loading} />;
        if (fleet.status === "error" || !fleet.data) return <ErrorState title={st.titles.vehicle} message={fleet.message ?? strings.common.generic} onRetry={fleet.retry} />;
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
  return (
    <Screen keyboard edges={["bottom"]}>
      <View accessible accessibilityLabel={`${st.of(index, total)}. ${st.titles[flow.step]}`}>
        <Masthead context={st.of(index, total)} title={st.titles[flow.step]} />
      </View>
      {body()}
      <FormError message={error} />
      {flow.step !== "type" ? (
        <View style={{ flexDirection: "row", gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.rule }}>
          <Button label={st.back} variant="secondary" onPress={goBack} style={{ flex: 1 }} testID="step-back" />
          {onReview ? (
            <Button label={sending ? st.sending : submitLabel} loading={sending} disabled={spaceBlocked} onPress={() => void send()} style={{ flex: 2 }} testID="submit" />
          ) : (
            <Button label={flow.step === "details" ? st.review : st.next} onPress={goNext} style={{ flex: 2 }} testID="step-next" />
          )}
        </View>
      ) : null}
    </Screen>
  );
}
