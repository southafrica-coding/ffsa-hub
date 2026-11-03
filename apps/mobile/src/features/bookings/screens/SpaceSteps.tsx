// The space-request steps of the new-request flow: which space, when, the
// details, and the review. The clash check is always the server's
// (POST /api/bookings with dryRun: true), never worked out on the phone.

import { useEffect, useState } from "react";
import { View } from "react-native";

import { Text, TextField } from "@/components";
import { Chips, Tag } from "@/features/finance/components/ui";
import { ListRow, openWebPage } from "@/features/shell";
import { useTheme } from "@/theme/use-theme";

import { checkSpace, userMessage, type SpaceCheck } from "../api";
import { bookingsFetch } from "../client";
import { ConflictList } from "../components/ConflictList";
import { DateTimeField } from "../components/DateTimeField";
import { CheckRow, ChoiceRow, Field, useAnnounceOnIOS } from "../components/ui";
import type { SpaceOptions } from "../data";
import { approvalNote, dateRangeLabel, spaceWhenError, timeRangeLabel, todayISO, type SpaceForm } from "../logic";
import { strings } from "../strings";

const w = strings.when;

export type SpaceCheckState = { status: "idle" | "checking" | "done" | "error"; result: SpaceCheck | null; message: string | null };

/**
 * Ask the server about clashes whenever the space and time are complete,
 * after a short pause so a turning time wheel doesn't fire a request per tick.
 */
export function useSpaceCheck(f: SpaceForm, enabled: boolean, delayMs = 400): SpaceCheckState {
  const key = enabled && f.venueId && !spaceWhenError(f) ? JSON.stringify([f.venueId, f.date, f.endDate, f.startTime, f.endTime, f.setupTime, f.setdownTime]) : null;
  // The answer is kept with the question it answers, so a stale answer never shows.
  const [answer, setAnswer] = useState<{ key: string; state: SpaceCheckState } | null>(null);
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      checkSpace(bookingsFetch, f, { signal: ctrl.signal }).then(
        (result) => setAnswer({ key, state: { status: "done", result, message: null } }),
        (err: unknown) => {
          if (!ctrl.signal.aborted) setAnswer({ key, state: { status: "error", result: null, message: userMessage(err) } });
        },
      );
    }, delayMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // `key` captures every field the check uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delayMs]);
  if (!key) return { status: "idle", result: null, message: null };
  return answer?.key === key ? answer.state : { status: "checking", result: null, message: null };
}

export function SpaceChoice({ options, f, set, canApprove }: { options: SpaceOptions; f: SpaceForm; set: (p: Partial<SpaceForm>) => void; canApprove: boolean }) {
  const { colors } = useTheme();
  if (options.venues.length === 0) return <Text tone="secondary">{strings.space.none}</Text>;
  const chosen = options.venues.find((v) => v.id === f.venueId);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={strings.steps.titles.space}>
      {options.venues.map((v) => {
        const selected = v.id === f.venueId;
        return (
          <ChoiceRow
            key={v.id}
            selected={selected}
            onPress={() => set({ venueId: v.id })}
            accessibilityLabel={[v.name, v.building, v.capacity ? strings.space.capacity(v.capacity) : null, v.requires_approval ? strings.space.needsApproval : strings.space.instant]
              .filter(Boolean)
              .join(". ")}
            testID={`venue-${v.id}`}
          >
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center", borderLeftWidth: selected ? 4 : 0, borderLeftColor: colors.text, paddingLeft: selected ? 8 : 0 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant={selected ? "bodyStrong" : "body"}>{v.name}</Text>
                {v.building || v.capacity ? (
                  <Text variant="caption" tone="secondary">
                    {[v.building, v.capacity ? strings.space.capacity(v.capacity) : null].filter(Boolean).join(" · ")}
                  </Text>
                ) : null}
              </View>
              <Tag tone={v.requires_approval ? "attention" : "default"}>{v.requires_approval ? strings.space.needsApproval : strings.space.instant}</Tag>
            </View>
          </ChoiceRow>
        );
      })}
      {chosen ? (
        <Text tone="secondary" style={{ marginTop: 12 }}>
          {approvalNote(chosen.requires_approval, canApprove)}
        </Text>
      ) : null}
    </View>
  );
}

export function SpaceWhen({ f, set, check }: { f: SpaceForm; set: (p: Partial<SpaceForm>) => void; check: SpaceCheckState }) {
  const { colors } = useTheme();
  const [multiDay, setMultiDay] = useState(!!f.endDate);
  const isMulti = multiDay && !!f.endDate && f.endDate > f.date;
  return (
    <View style={{ gap: 16 }}>
      <DateTimeField mode="date" label={w.date} value={f.date} onChange={(v) => set({ date: v })} minimumDate={todayISO()} testID="date" />
      <CheckRow
        label={w.addEndDate}
        checked={multiDay}
        onChange={(on) => {
          setMultiDay(on);
          if (!on) set({ endDate: "" });
        }}
        testID="multi-day"
      />
      {multiDay ? <DateTimeField mode="date" label={w.endDate} value={f.endDate} onChange={(v) => set({ endDate: v })} minimumDate={f.date || todayISO()} testID="end-date" /> : null}
      {isMulti ? null : (
        <>
          <Text tone="secondary">{w.allDayNote}</Text>
          <DateTimeField mode="time" label={w.start} value={f.startTime} onChange={(v) => set({ startTime: v })} clearable testID="start" />
          <DateTimeField mode="time" label={w.end} value={f.endTime} onChange={(v) => set({ endTime: v })} clearable testID="end" />
          <DateTimeField mode="time" label={w.setup} value={f.setupTime} onChange={(v) => set({ setupTime: v })} clearable testID="setup" />
          <DateTimeField mode="time" label={w.setdown} value={f.setdownTime} onChange={(v) => set({ setdownTime: v })} clearable testID="setdown" />
        </>
      )}
      <CheckResult check={check} />
      <ListRow title={w.weeklyLink} subtitle={w.weeklyNote} trailing="web" onPress={() => void openWebPage("/bookings/spaces/new", colors)} />
    </View>
  );
}

export function CheckResult({ check }: { check: SpaceCheckState }) {
  // The answer arrives a moment after the time changes: say it (clashes are
  // spoken by ConflictList). Android reads the live regions instead.
  const free = check.status === "done" && !!check.result && check.result.conflicts.length === 0;
  useAnnounceOnIOS(check.status === "error" ? check.message : free ? w.free : null);
  if (check.status === "checking") {
    return (
      <Text tone="secondary" accessibilityLiveRegion="polite">
        {w.checking}
      </Text>
    );
  }
  if (check.status === "error") {
    return (
      <Text tone="danger" accessibilityLiveRegion="polite">
        {check.message}
      </Text>
    );
  }
  if (check.status !== "done" || !check.result) return null;
  if (check.result.conflicts.length === 0) {
    return (
      <Text tone="positive" testID="space-free" accessibilityLiveRegion="polite">
        {w.free}
      </Text>
    );
  }
  return <ConflictList conflicts={check.result.conflicts} blocked={check.result.blocked} />;
}

export function SpaceDetails({ options, f, set }: { options: SpaceOptions; f: SpaceForm; set: (p: Partial<SpaceForm>) => void }) {
  const d = strings.details;
  return (
    <View style={{ gap: 16 }}>
      <TextField label={d.title} value={f.title} onChangeText={(v) => set({ title: v })} placeholder={d.titlePlaceholder} testID="title" />
      {options.ministries.length > 0 ? (
        <Chips
          label={d.ministry}
          options={[{ value: "", label: d.noMinistry }, ...options.ministries.map((m) => ({ value: m.id, label: m.name }))]}
          value={f.ministryId}
          onChange={(v) => set({ ministryId: v })}
        />
      ) : null}
      <TextField label={d.description} value={f.description} onChangeText={(v) => set({ description: v })} multiline />
      <TextField label={d.pointPerson} value={f.pointPerson} onChangeText={(v) => set({ pointPerson: v })} />
      <TextField label={d.requesterName} value={f.requesterName} onChangeText={(v) => set({ requesterName: v })} />
    </View>
  );
}

export function SpaceReview({ options, f, check }: { options: SpaceOptions; f: SpaceForm; check: SpaceCheckState }) {
  const venue = options.venues.find((v) => v.id === f.venueId);
  const ministry = options.ministries.find((m) => m.id === f.ministryId);
  const multi = !!f.endDate && f.endDate > f.date;
  const r = strings.review;
  return (
    <View style={{ gap: 4 }}>
      <Field label={r.what} value={f.title} />
      <Field label={strings.detail.where} value={venue?.name} />
      <Field label={r.when} value={`${dateRangeLabel(f.date, f.endDate || null)}${multi ? "" : ` · ${timeRangeLabel(f.startTime || null, f.endTime || null)}`}`} />
      <Field label={strings.detail.setup} value={multi ? null : f.setupTime || null} />
      <Field label={strings.detail.setdown} value={multi ? null : f.setdownTime || null} />
      <Field label={strings.detail.ministry} value={ministry?.name} />
      <Field label={strings.detail.pointPerson} value={f.pointPerson || null} />
      <Field label={strings.detail.requestedBy} value={f.requesterName || null} />
      <Field label={strings.detail.description} value={f.description || null} />
      {check.status === "checking" ? <Text tone="secondary">{r.checking}</Text> : null}
      <CheckResult check={check} />
    </View>
  );
}
