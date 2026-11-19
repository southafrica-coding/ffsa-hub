// The space-request steps of the new-request flow: which space, when, the
// details, and the review. The clash check is always the server's
// (POST /api/bookings with dryRun: true), never worked out on the phone.

import { Check, Clock } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { Banner, Bleed, ChoiceChips, ListGroup, ListRow, RadioRow, StatusChip, Text, TextField, Toggle } from "@/components";
import { openWebPage } from "@/features/shell";
import { useAnnounceOnIOS } from "@/lib/a11y";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { checkSpace, userMessage, type SpaceCheck } from "../api";
import { bookingsFetch } from "../client";
import { ConflictList } from "../components/ConflictList";
import { DateTimeField } from "../components/DateTimeField";
import { Field, FieldList, HintLine, ToggleRow } from "../components/ui";
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

/** Two fields side by side; they stack when there isn't room (narrow phone, large text). */
function FieldPair({ children }: { children: [React.ReactNode, React.ReactNode] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: space.md }}>
      {children.map((child, i) => (
        <View key={i} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 140 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

// 7.7: every space says in words whether it needs approval; under the list,
// what will happen to a request for the chosen one.
export function SpaceChoice({ options, f, set, canApprove }: { options: SpaceOptions; f: SpaceForm; set: (p: Partial<SpaceForm>) => void; canApprove: boolean }) {
  const { colors } = useTheme();
  if (options.venues.length === 0) return <Text tone="secondary">{strings.space.none}</Text>;
  const chosen = options.venues.find((v) => v.id === f.venueId);
  return (
    <Bleed style={{ gap: space.md }}>
      <View accessibilityRole="radiogroup" accessibilityLabel={strings.steps.titles.space}>
        <ListGroup inset={false}>
          {options.venues.map((v) => {
            const selected = v.id === f.venueId;
            const detail = [v.building, v.capacity ? strings.space.capacity(v.capacity) : null].filter(Boolean).join(" · ");
            return (
              <RadioRow
                key={v.id}
                mark="leading"
                checked={selected}
                onPress={() => set({ venueId: v.id })}
                accessibilityLabel={[v.name, v.building, v.capacity ? strings.space.capacity(v.capacity) : null, v.requires_approval ? strings.space.needsApproval : strings.space.instant]
                  .filter(Boolean)
                  .join(". ")}
                testID={`venue-${v.id}`}
              >
                {/* The chip sits on the right, and drops under the name when it doesn't fit. */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.md, rowGap: 6 }}>
                  <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 120, gap: 2 }}>
                    <Text variant="rowTitle">{v.name}</Text>
                    {detail ? (
                      <Text variant="caption" tone="secondary">
                        {detail}
                      </Text>
                    ) : null}
                  </View>
                  {v.requires_approval ? (
                    <StatusChip label={strings.space.needsApproval} variant="attention" icon={Clock} />
                  ) : (
                    <StatusChip label={strings.space.instant} variant="quiet" icon={Check} />
                  )}
                </View>
              </RadioRow>
            );
          })}
        </ListGroup>
      </View>
      {chosen ? <Banner tone="info">{approvalNote(chosen.requires_approval, canApprove)}</Banner> : null}
      <ListGroup inset={false}>
        <ListRow title={w.weeklyLink} subtitle={w.weeklyNote} trailing="web" onPress={() => void openWebPage("/bookings/spaces/new", colors)} />
      </ListGroup>
    </Bleed>
  );
}

// 7.3: the date, a switch for several days, then the event times and the
// optional set-up / set-down, two to a row; the server's clash answer under them.
export function SpaceWhen({ f, set, check }: { f: SpaceForm; set: (p: Partial<SpaceForm>) => void; check: SpaceCheckState }) {
  const [multiDay, setMultiDay] = useState(!!f.endDate);
  const isMulti = multiDay && !!f.endDate && f.endDate > f.date;
  return (
    <View style={{ gap: space.lg }}>
      <DateTimeField mode="date" label={w.date} value={f.date} onChange={(v) => set({ date: v })} minimumDate={todayISO()} testID="date" />
      <ToggleRow label={w.addEndDate}>
        <Toggle
          value={multiDay}
          accessibilityLabel={w.addEndDate}
          onValueChange={(on) => {
            setMultiDay(on);
            if (!on) set({ endDate: "" });
          }}
          testID="multi-day"
        />
      </ToggleRow>
      {multiDay ? <DateTimeField mode="date" label={w.endDate} value={f.endDate} onChange={(v) => set({ endDate: v })} minimumDate={f.date || todayISO()} testID="end-date" /> : null}
      {isMulti ? null : (
        <>
          <Text variant="caption" tone="secondary" style={{ marginTop: -space.sm }}>
            {w.allDayNote}
          </Text>
          <FieldPair>
            <DateTimeField mode="time" label={w.start} value={f.startTime} onChange={(v) => set({ startTime: v })} clearable testID="start" />
            <DateTimeField mode="time" label={w.end} value={f.endTime} onChange={(v) => set({ endTime: v })} clearable testID="end" />
          </FieldPair>
          <FieldPair>
            <DateTimeField mode="time" label={w.setup} value={f.setupTime} onChange={(v) => set({ setupTime: v })} clearable testID="setup" />
            <DateTimeField mode="time" label={w.setdown} value={f.setdownTime} onChange={(v) => set({ setdownTime: v })} clearable testID="setdown" />
          </FieldPair>
        </>
      )}
      <CheckResult check={check} />
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
      <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
        {w.checking}
      </Text>
    );
  }
  if (check.status === "error") {
    return (
      <View accessibilityLiveRegion="polite">
        <HintLine tone="bad">{check.message ?? strings.common.generic}</HintLine>
      </View>
    );
  }
  if (check.status !== "done" || !check.result) return null;
  if (check.result.conflicts.length === 0) {
    return (
      <View accessibilityLiveRegion="polite" testID="space-free">
        <HintLine tone="ok">{w.free}</HintLine>
      </View>
    );
  }
  return <ConflictList conflicts={check.result.conflicts} blocked={check.result.blocked} />;
}

export function SpaceDetails({ options, f, set }: { options: SpaceOptions; f: SpaceForm; set: (p: Partial<SpaceForm>) => void }) {
  const d = strings.details;
  return (
    <View style={{ gap: space.lg }}>
      <TextField label={d.title} value={f.title} onChangeText={(v) => set({ title: v })} placeholder={d.titlePlaceholder} testID="title" />
      {options.ministries.length > 0 ? (
        <ChoiceChips
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

// 7.8: what will be sent, label left and value right, then the clash answer.
export function SpaceReview({ options, f, check }: { options: SpaceOptions; f: SpaceForm; check: SpaceCheckState }) {
  const venue = options.venues.find((v) => v.id === f.venueId);
  const ministry = options.ministries.find((m) => m.id === f.ministryId);
  const multi = !!f.endDate && f.endDate > f.date;
  const r = strings.review;
  return (
    <View style={{ gap: space.lg }}>
      <FieldList>
        <Field label={r.what} value={f.title} />
        <Field label={strings.detail.where} value={venue?.name} />
        <Field label={r.when} value={`${dateRangeLabel(f.date, f.endDate || null)}${multi ? "" : ` · ${timeRangeLabel(f.startTime || null, f.endTime || null)}`}`} />
        <Field label={strings.detail.setup} value={multi ? null : f.setupTime || null} />
        <Field label={strings.detail.setdown} value={multi ? null : f.setdownTime || null} />
        <Field label={strings.detail.ministry} value={ministry?.name} />
        <Field label={strings.detail.pointPerson} value={f.pointPerson || null} />
        <Field label={strings.detail.requestedBy} value={f.requesterName || null} />
        <Field label={strings.detail.description} value={f.description || null} />
      </FieldList>
      {check.status === "checking" ? (
        <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
          {r.checking}
        </Text>
      ) : (
        <CheckResult check={check} />
      )}
    </View>
  );
}
