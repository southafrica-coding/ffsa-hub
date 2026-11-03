import { useState } from "react";
import { View } from "react-native";

import { Banner, Button, Text } from "@/components";
import { ListRow, SkeletonRows, openWebPage } from "@/features/shell";
import { hairline } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { askForSeat, respondToInvite, type Band, type PrayerSet, type SeatRequest, type SeatType, type Slot } from "../api";
import { prayerFetch } from "../api-client";
import { useAction, useSetDetail, type ActionResult } from "../hooks";
import {
  bandFor,
  canManageSet,
  dayLabel,
  displayName,
  durationLabel,
  friendlyError,
  fullName,
  isForbidden,
  isOpenSeat,
  leadNames,
  lineup,
  seatCounts,
  seatLabel,
  setTitle,
  spokenDate,
  spokenTimeRange,
  timeRange,
  type PrayerAccess,
} from "../logic";
import { strings } from "../strings";

import { ActionNotice, Chip, LabelRow, Sheet } from "./ui";

/**
 * The set drawer (web frames 9a / 10b) as a bottom sheet: when, who leads,
 * what we're praying, and the lineup with the actions the web gives THIS
 * person: accept or decline an invitation, or ask the lead for an open seat.
 * Filling seats, removing people and editing the set are the owner's and
 * staff's tools; those open the website.
 */
export function SetSheet({
  setId,
  onClose,
  onChanged,
  seatTypes,
  bands,
  userId,
  access,
}: {
  setId: string | null;
  onClose: () => void;
  onChanged: () => void;
  seatTypes: SeatType[];
  bands: Band[];
  userId: string | null;
  access: PrayerAccess;
}) {
  const { colors } = useTheme();
  const { state, reload, retry } = useSetDetail(setId);
  const { busy, run } = useAction();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [shownFor, setShownFor] = useState(setId);
  if (shownFor !== setId) {
    // A different set: forget the last one's message.
    setShownFor(setId);
    setResult(null);
  }

  const after = async (r: ActionResult | null) => {
    if (!r) return;
    setResult(r);
    // Reload either way: on a clash, the lineup has changed under us.
    await reload();
    if (r.ok) onChanged();
  };

  const ready = state.status === "ready" ? state.data : null;
  const set = ready?.set ?? null;
  const when = set ? `${spokenDate(set.set_date)}, ${spokenTimeRange(set.start_time, set.end_time)}` : "";

  const accept = (slot: Slot) =>
    run(
      slot.id,
      {
        title: strings.set.confirmAcceptTitle,
        body: strings.set.confirmAcceptBody(seatLabel(slot, seatTypes), when),
        confirm: strings.set.accept,
        cancel: strings.set.cancel,
      },
      () => respondToInvite(prayerFetch, slot.id, "accept"),
      strings.set.accepted,
    ).then(after);

  const decline = (slot: Slot) =>
    run(
      slot.id,
      {
        title: strings.set.confirmDeclineTitle,
        body: strings.set.confirmDeclineBody,
        confirm: strings.set.decline,
        cancel: strings.set.cancel,
        destructive: true,
      },
      () => respondToInvite(prayerFetch, slot.id, "decline"),
      strings.set.declined,
    ).then(after);

  const ask = (slot: Slot) =>
    run(
      slot.id,
      {
        title: strings.set.confirmAskTitle,
        body: strings.set.confirmAskBody(seatLabel(slot, seatTypes)),
        confirm: strings.set.askToJoin,
        cancel: strings.set.cancel,
      },
      () => askForSeat(prayerFetch, set!.id, slot.seat_type_id ?? slot.role),
      strings.set.requestSent,
    ).then(after);

  const title = set ? setTitle(set) : strings.set.devo;
  const band = set ? bandFor(set, bands) : null;
  const leadLine = set ? leadNames(set, seatTypes) : null;

  return (
    <Sheet visible={!!setId} title={set ? dayLabel(set.set_date) : strings.set.devo} onClose={onClose} testID="set-sheet">
      {state.status === "loading" ? <SkeletonRows label={strings.set.loading} /> : null}

      {state.status === "error" ? (
        <Banner
          tone="danger"
          testID="set-error"
          action={<Button label={strings.errors.retry} variant="secondary" onPress={retry} />}
        >
          {isForbidden(state.error) ? strings.errors.forbiddenBody : friendlyErrorOrMissing(state.error)}
        </Banner>
      ) : null}

      {set && ready ? (
        <>
          {/* ── identity ─────────────────────────── */}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {band ? <Chip label={band} tone="band" /> : null}
              {set.status !== "scheduled" ? <Chip label={set.status} /> : null}
              {set.series_id ? <Chip label={strings.set.repeats} /> : null}
            </View>
            <Text variant="display">{title}</Text>
            <View
              accessible
              accessibilityLabel={`${spokenDate(set.set_date)}, ${spokenTimeRange(set.start_time, set.end_time)}`}
              style={{ flexDirection: "row", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}
            >
              <Text variant="title" style={{ fontVariant: ["tabular-nums"] }}>
                {timeRange(set.start_time, set.end_time)}
              </Text>
              <Text variant="label" tone="secondary">
                {dayLabel(set.set_date)} · {durationLabel(set.start_time, set.end_time)}
              </Text>
            </View>
            <Text tone="secondary">
              {[set.owner ? strings.set.setUpBy(fullName(set.owner)) : null, leadLine ? strings.set.ledBy(leadLine) : strings.set.noLead]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>

          {set.relocation_note ? <Banner tone="info">{strings.set.relocated(set.relocation_note)}</Banner> : null}

          <ActionNotice result={result} />

          {/* ── what we're praying ───────────────── */}
          {set.prayer_focus || set.theme || set.scripture ? (
            <View style={{ gap: 6 }}>
              <LabelRow label={strings.set.praying} />
              <Text>{set.prayer_focus ?? strings.set.nothingWritten}</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {[set.theme, set.scripture].filter((t): t is string => !!t).map((t) => (
                  <Chip key={t} label={t} />
                ))}
              </View>
            </View>
          ) : null}

          {/* ── the lineup ───────────────────────── */}
          <Lineup
            ready={ready}
            seatTypes={seatTypes}
            userId={userId}
            canManage={canManageSet(set, userId, access)}
            busy={busy}
            onAccept={accept}
            onDecline={decline}
            onAsk={ask}
          />

          {set.setlist ? (
            <View style={{ gap: 6, padding: 12, backgroundColor: colors.surface }}>
              <LabelRow label={strings.set.walkIn} />
              <Text>{set.setlist}</Text>
            </View>
          ) : null}

          {canManageSet(set, userId, access) ? (
            <ListRow
              title={strings.set.manageOnWeb}
              trailing="web"
              onPress={() => openWebPage("/prayer-room", colors)}
              testID="manage-on-web"
            />
          ) : (
            <Text variant="caption" tone="secondary">
              {strings.set.leaveNote(set.owner ? displayName(set.owner) : null)}
            </Text>
          )}
        </>
      ) : null}
    </Sheet>
  );
}

function friendlyErrorOrMissing(err: unknown): string {
  // A set that's gone (cancelled, deleted) comes back as a 500 from .single().
  const msg = friendlyError(err);
  return msg === strings.errors.actionFailed ? strings.set.notFound : msg;
}

function Lineup({
  ready,
  seatTypes,
  userId,
  canManage,
  busy,
  onAccept,
  onDecline,
  onAsk,
}: {
  ready: { set: PrayerSet; requests: SeatRequest[] };
  seatTypes: SeatType[];
  userId: string | null;
  canManage: boolean;
  busy: string | null;
  onAccept: (s: Slot) => void;
  onDecline: (s: Slot) => void;
  onAsk: (s: Slot) => void;
}) {
  const { colors } = useTheme();
  const { set, requests } = ready;
  const { leads, others } = lineup(set, seatTypes);
  const c = seatCounts(set);
  const asked = new Set(
    requests.filter((r) => r.user_id === userId && r.state === "pending").map((r) => r.seat_type_id),
  );

  const row = (slot: Slot, lead: boolean) => {
    const label = seatLabel(slot, seatTypes);
    const person = slot.status === "filled" ? slot.filled : slot.status === "invited" ? slot.invitee : null;
    const invitedMe = slot.status === "invited" && slot.invitee_id === userId;
    const me = slot.status === "filled" && slot.filled_user_id === userId;
    const empty = isOpenSeat(slot);
    const seatKey = slot.seat_type_id ?? slot.role;
    const spoken = empty
      ? `${label}, ${strings.set.nobody}`
      : `${label}, ${me ? strings.set.you : displayName(person)}${slot.status === "invited" ? `, ${strings.set.invitedPending}` : ""}`;

    return (
      <View
        key={slot.id}
        testID={`seat-${slot.id}`}
        style={{
          paddingVertical: 10,
          gap: 8,
          borderBottomWidth: hairline,
          borderBottomColor: colors.rule,
        }}
      >
        <View accessible accessibilityLabel={spoken} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
          <Text
            variant={lead ? "bodyStrong" : "label"}
            tone={lead ? "default" : "secondary"}
            style={{ width: 104, textTransform: "uppercase" }}
          >
            {label}
          </Text>
          <View style={{ flex: 1, gap: 2 }}>
            {empty ? (
              <Text tone="secondary">
                {strings.set.nobody}
                {slot.required_label ? ` · ${slot.required_label.name}` : ""}
              </Text>
            ) : (
              <>
                <Text variant="bodyStrong">{me || invitedMe ? strings.set.you : displayName(person)}</Text>
                {slot.status === "invited" ? (
                  <Text variant="caption" tone="secondary">
                    {strings.set.invitedPending}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </View>

        {invitedMe ? (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button
              label={strings.set.accept}
              onPress={() => onAccept(slot)}
              loading={busy === slot.id}
              disabled={!!busy}
              accessibilityLabel={`${strings.set.accept} ${label}`}
            />
            <Button
              label={strings.set.decline}
              variant="secondary"
              onPress={() => onDecline(slot)}
              disabled={!!busy}
              accessibilityLabel={`${strings.set.decline} ${label}`}
            />
          </View>
        ) : null}

        {empty && !canManage && set.status === "scheduled" ? (
          asked.has(seatKey) ? (
            <Chip label={strings.set.asked} testID={`asked-${slot.id}`} />
          ) : (
            <View style={{ flexDirection: "row" }}>
              <Button
                label={strings.set.askToJoin}
                variant="secondary"
                onPress={() => onAsk(slot)}
                loading={busy === slot.id}
                disabled={!!busy}
                accessibilityLabel={`${strings.set.askToJoin}: ${label}`}
                accessibilityHint={strings.set.askHint(label)}
              />
            </View>
          )
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: 4 }}>
      <LabelRow label={strings.set.lineup} right={strings.set.openSeats(c.open, c.total)} />
      {set.slots.length === 0 ? <Text tone="secondary">{strings.set.noSeats}</Text> : null}
      {leads.map((s) => row(s, true))}
      {leads.length > 0 && others.length > 0 ? (
        <View style={{ height: 2, backgroundColor: colors.text, marginVertical: 4 }} />
      ) : null}
      {others.map((s) => row(s, false))}
    </View>
  );
}
