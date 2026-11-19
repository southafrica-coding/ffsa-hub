// The vehicle-request steps: dates, an optional vehicle, drivers, details
// and the review. Which vehicles are taken comes from the server's own
// overlap check (POST /api/vehicles/bookings with dryRun: true). The
// licence status shown per driver is a hint: the API re-reads every
// driver's licence at submit and again at approval.

import { Plus, Search, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { Banner, Button, ListGroup, ListRow, Sheet, Text, TextField, Toggle } from "@/components";
import { ChoiceChips } from "@/features/finance/components/form-parts";
import { openWebPage } from "@/features/shell";
import { hairline, radius, space, touch } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { checkVehicles } from "../api";
import { bookingsFetch } from "../client";
import { DateTimeField } from "../components/DateTimeField";
import { Bleed, CheckRow, Field, FieldList, HintLine, Panel, useAnnounceOnIOS } from "../components/ui";
import {
  dateRangeLabel,
  dayCount,
  driverFromPerson,
  licenceStatus,
  PURPOSE_OPTIONS,
  purposeLabel,
  todayISO,
  vehicleWhenError,
  type Purpose,
  type VehicleForm,
} from "../logic";
import { strings } from "../strings";
import type { Person, Vehicle } from "../types";

export type VehicleCheckState = { status: "idle" | "checking" | "done" | "error"; unavailable: string[] };

/** Taken vehicles for the chosen dates, from the server; re-asked when the dates change. */
export function useVehicleAvailability(f: VehicleForm, delayMs = 300): VehicleCheckState {
  const key = vehicleWhenError(f) ? null : `${f.checkout}|${f.returnDate}`;
  const [answer, setAnswer] = useState<{ key: string; state: VehicleCheckState } | null>(null);
  const { checkout, returnDate } = f;
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      checkVehicles(bookingsFetch, checkout, returnDate, [], { signal: ctrl.signal }).then(
        (r) => setAnswer({ key, state: { status: "done", unavailable: r.unavailableVehicleIds } }),
        () => {
          if (!ctrl.signal.aborted) setAnswer({ key, state: { status: "error", unavailable: [] } });
        },
      );
    }, delayMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, checkout, returnDate, delayMs]);
  if (!key) return { status: "idle", unavailable: [] };
  return answer?.key === key ? answer.state : { status: "checking", unavailable: [] };
}

export function VehicleWhen({ f, set }: { f: VehicleForm; set: (p: Partial<VehicleForm>) => void }) {
  const w = strings.when;
  const valid = !vehicleWhenError(f);
  return (
    <View style={{ gap: space.lg }}>
      <Text tone="secondary">{strings.details.vehicleNote}</Text>
      <DateTimeField
        mode="date"
        label={w.collect}
        value={f.checkout}
        onChange={(v) => set({ checkout: v, returnDate: f.returnDate && f.returnDate >= v ? f.returnDate : v })}
        minimumDate={todayISO()}
        testID="checkout"
      />
      <DateTimeField mode="date" label={w.return} value={f.returnDate} onChange={(v) => set({ returnDate: v })} minimumDate={f.checkout || todayISO()} testID="return" />
      {valid ? (
        <Text variant="caption" tone="secondary">
          {w.days(dayCount(f.checkout, f.returnDate))}
        </Text>
      ) : null}
    </View>
  );
}

export function VehicleChoice({ fleet, f, set, check }: { fleet: Vehicle[]; f: VehicleForm; set: (p: Partial<VehicleForm>) => void; check: VehicleCheckState }) {
  const v = strings.vehicle;
  useAnnounceOnIOS(check.status === "error" ? v.checkFailed : null);
  if (fleet.length === 0) return <Text tone="secondary">{v.noFleet}</Text>;
  return (
    <View style={{ gap: space.md }}>
      <Text tone="secondary">{v.optional}</Text>
      {check.status === "checking" ? (
        <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
          {strings.when.checking}
        </Text>
      ) : null}
      {check.status === "error" ? (
        <View accessibilityLiveRegion="polite">
          <HintLine tone="warn">{v.checkFailed}</HintLine>
        </View>
      ) : null}
      <Bleed>
        <Panel>
          {fleet.map((car) => {
            const taken = check.unavailable.includes(car.id);
            const chosen = f.vehicleIds.includes(car.id);
            const detail = [car.make_model, car.registration_plate, car.seats ? v.seats(car.seats) : null].filter(Boolean).join(" · ");
            // A taken vehicle can still be un-ticked, never ticked.
            const disabled = taken && !chosen;
            return (
              <View key={car.id} style={{ opacity: disabled ? 0.55 : 1 }}>
                <CheckRow
                  testID={`vehicle-${car.id}`}
                  label={car.name}
                  hint={[detail, check.status === "done" ? (taken ? v.taken : v.free) : null].filter(Boolean).join(" · ")}
                  checked={chosen}
                  unavailable={disabled}
                  onChange={(on) => {
                    if (disabled) return;
                    set({ vehicleIds: on ? [...f.vehicleIds, car.id] : f.vehicleIds.filter((id) => id !== car.id) });
                  }}
                />
              </View>
            );
          })}
        </Panel>
      </Bleed>
    </View>
  );
}

// 7.9: each driver with a licence hint (icon + words) and the first-time
// switch; then add me, add someone from FFSA Hub (a search sheet), or add an
// outside driver on the website.
export function VehicleDrivers({
  people,
  peopleState,
  meId,
  f,
  set,
  onRetryPeople,
}: {
  people: Person[];
  peopleState: "loading" | "ready" | "error";
  meId: string | null;
  f: VehicleForm;
  set: (p: Partial<VehicleForm>) => void;
  onRetryPeople: () => void;
}) {
  const dr = strings.drivers;
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const chosen = new Set(f.drivers.map((d) => d.userId));
  const me = meId ? byId.get(meId) : undefined;
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people).slice(0, 40);
  }, [people, q]);

  function add(p: Person) {
    if (chosen.has(p.id)) return;
    set({ drivers: [...f.drivers, driverFromPerson(p)] });
  }

  return (
    <View style={{ gap: space.md }}>
      <Text tone="secondary">{dr.intro}</Text>
      {peopleState === "loading" ? (
        <Text variant="caption" tone="secondary" accessibilityRole="progressbar" accessibilityLabel={dr.loading}>
          {dr.loading}
        </Text>
      ) : null}
      {peopleState === "error" ? (
        <Bleed>
          <Banner tone="error" actionLabel={strings.common.tryAgain} onAction={onRetryPeople}>
            {dr.loadFailed}
          </Banner>
        </Bleed>
      ) : null}

      {f.drivers.length > 0 ? (
        <Bleed>
          <ListGroup inset={false}>
            {f.drivers.map((d) => {
              const p = byId.get(d.userId);
              const st = p ? licenceStatus(p, f.returnDate || null) : null;
              return (
                <View key={d.userId} style={{ paddingLeft: space.lg, paddingRight: space.xs, paddingVertical: space.sm, gap: space.xs }} testID={`driver-${d.userId}`}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
                    <View style={{ flex: 1, gap: 2, paddingTop: 10 }}>
                      <Text variant="rowTitle">{d.name}</Text>
                      {st ? <HintLine tone={st.tone}>{st.label}</HintLine> : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={dr.remove(d.name)}
                      onPress={() => set({ drivers: f.drivers.filter((x) => x.userId !== d.userId) })}
                      style={({ pressed }) => ({
                        width: touch.floor,
                        height: touch.floor,
                        borderRadius: radius.control,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: pressed ? colors.surfaceStrong : "transparent",
                      })}
                    >
                      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        <X size={18} color={colors.text} />
                      </View>
                    </Pressable>
                  </View>
                  <View style={{ minHeight: touch.floor, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingRight: space.sm }}>
                    {/* The switch carries these words itself. */}
                    <Text variant="caption" style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no">
                      {dr.firstTime}
                    </Text>
                    <Toggle
                      value={d.isFirstTime}
                      accessibilityLabel={`${d.name}. ${dr.firstTime}`}
                      accessibilityHint={dr.firstTimeHint}
                      onValueChange={(on) => set({ drivers: f.drivers.map((x) => (x.userId === d.userId ? { ...x, isFirstTime: on } : x)) })}
                    />
                  </View>
                </View>
              );
            })}
          </ListGroup>
        </Bleed>
      ) : null}

      {peopleState === "ready" && me && !chosen.has(me.id) ? (
        <Button label={dr.addMe} variant="secondary" icon={<Plus size={20} color={colors.text} />} onPress={() => add(me)} testID="add-me" />
      ) : null}
      {peopleState === "ready" ? (
        <View style={{ gap: 6 }}>
          {/* The button below says these words itself. */}
          <Text variant="label" accessibilityElementsHidden importantForAccessibility="no">
            {dr.addPerson}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dr.addPerson}
            accessibilityHint={dr.searchHint}
            onPress={() => setOpen(true)}
            testID="add-driver"
            style={({ pressed }) => ({
              minHeight: touch.minTarget,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.sm,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: radius.control,
              borderWidth: hairline,
              borderColor: colors.ruleStrong,
              backgroundColor: pressed ? colors.surface : colors.raised,
            })}
          >
            <Text tone="quiet" style={{ flex: 1 }}>
              {dr.search}
            </Text>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Search size={18} color={colors.textTertiary} />
            </View>
          </Pressable>
        </View>
      ) : null}
      <Bleed>
        <ListGroup inset={false}>
          <ListRow title={dr.outsiderLink} subtitle={dr.outsider} trailing="web" onPress={() => void openWebPage("/bookings/vehicles/new", colors)} />
        </ListGroup>
      </Bleed>

      <Sheet visible={open} title={dr.addPerson} onClose={() => setOpen(false)}>
        <TextField label={dr.search} hint={dr.searchHint} value={q} onChangeText={setQ} autoCorrect={false} testID="driver-search" />
        {matches.length === 0 ? (
          <Text tone="secondary">{dr.noMatches}</Text>
        ) : (
          <ListGroup inset={false}>
            {matches.map((p) => {
              const st = licenceStatus(p, f.returnDate || null);
              const already = chosen.has(p.id);
              return (
                <ListRow
                  key={p.id}
                  title={p.name}
                  trailing="none"
                  disabled={already}
                  onPress={
                    already
                      ? undefined
                      : () => {
                          add(p);
                          setOpen(false);
                          setQ("");
                        }
                  }
                  accessibilityLabel={`${p.name}. ${already ? dr.already : st.label}`}
                  testID={`person-${p.id}`}
                >
                  {already ? (
                    <Text variant="caption" tone="secondary">
                      {dr.already}
                    </Text>
                  ) : (
                    <HintLine tone={st.tone}>{st.label}</HintLine>
                  )}
                </ListRow>
              );
            })}
          </ListGroup>
        )}
      </Sheet>
    </View>
  );
}

export function VehicleDetails({ f, set }: { f: VehicleForm; set: (p: Partial<VehicleForm>) => void }) {
  const d = strings.details;
  return (
    <View style={{ gap: space.lg }}>
      <TextField label={d.bookingName} value={f.bookingName} onChangeText={(v) => set({ bookingName: v })} placeholder={d.bookingNamePlaceholder} testID="booking-name" />
      <TextField label={d.vPointPerson} hint={d.vPointPersonHint} value={f.pointPerson} onChangeText={(v) => set({ pointPerson: v })} testID="point-person" />
      <TextField label={d.destination} value={f.destination} onChangeText={(v) => set({ destination: v })} placeholder={d.destinationPlaceholder} testID="destination" />
      <ChoiceChips<Purpose> label={d.purpose} options={PURPOSE_OPTIONS.map((p) => ({ value: p.value, label: p.label }))} value={f.purpose} onChange={(v) => set({ purpose: v })} />
      {f.purpose === "other" ? <TextField label={d.purposeNote} value={f.purposeNote} onChangeText={(v) => set({ purposeNote: v })} testID="purpose-note" /> : null}
      <TextField label={d.numPeople} value={f.numPeople} onChangeText={(v) => set({ numPeople: v.replace(/[^\d]/g, "") })} keyboardType="number-pad" />
      <TextField label={d.requesterName} value={f.requesterName} onChangeText={(v) => set({ requesterName: v })} />
      <TextField label={d.email} value={f.requesterEmail} onChangeText={(v) => set({ requesterEmail: v })} keyboardType="email-address" autoCapitalize="none" />
      <TextField label={d.whatsapp} value={f.requesterPhone} onChangeText={(v) => set({ requesterPhone: v })} keyboardType="phone-pad" placeholder="+27…" />
      <TextField label={d.homeCountry} hint={d.homeCountryHint} value={f.homeCountry} onChangeText={(v) => set({ homeCountry: v.toUpperCase().slice(0, 2) })} autoCapitalize="characters" />
      <TextField label={d.notes} value={f.notes} onChangeText={(v) => set({ notes: v })} multiline />
    </View>
  );
}

export function VehicleReview({ fleet, f }: { fleet: Vehicle[]; f: VehicleForm }) {
  const r = strings.review;
  const names = f.vehicleIds.map((id) => fleet.find((v) => v.id === id)?.name).filter(Boolean).join(", ");
  return (
    <View style={{ gap: space.lg }}>
      <FieldList>
        <Field label={strings.details.bookingName} value={f.bookingName} />
        <Field label={r.when} value={`${dateRangeLabel(f.checkout, f.returnDate)} · ${strings.detail.days(dayCount(f.checkout, f.returnDate))}`} />
        <Field label={strings.detail.vehicles} value={names || strings.vehicle.optional} />
        <Field label={strings.detail.drivers} value={f.drivers.map((d) => d.name).join(", ")} />
        <Field label={strings.detail.purpose} value={f.purpose === "other" ? f.purposeNote : purposeLabel(f.purpose)} />
        <Field label={strings.detail.destination} value={f.destination} />
        <Field label={strings.detail.pointPerson} value={f.pointPerson} />
        <Field label={strings.detail.requestedBy} value={f.requesterName || null} />
        <Field label={strings.detail.whatsapp} value={f.requesterPhone || null} />
        <Field label={strings.detail.people} value={f.numPeople || null} />
        <Field label={strings.detail.notes} value={f.notes || null} />
      </FieldList>
      <Text variant="caption" tone="secondary">
        {strings.details.vehicleNote}
      </Text>
    </View>
  );
}
