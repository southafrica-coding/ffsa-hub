import { Clock, MapPin, Repeat } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { Banner, Button, ListGroup, ListRow, Sheet, SkeletonList, StatusChip, Text } from "@/components";
import { openWebPage } from "@/features/shell";
import { fontFamily, hairline, radius, space } from "@/theme/tokens";
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

import { ActionNotice, BandChip, LabelRow } from "./ui";

/**
 * The set as a bottom sheet (frames 4.2, 4.3): when, who leads, what we're
 * praying, and the lineup, one row per seat with the two lead seats first,
 * with the actions the web gives THIS person: accept or decline an
 * invitation, or ask the lead for an open seat. Filling seats, removing
 * people and editing the set are the owner's and staff's tools; those open
 * the website.
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
    <Sheet
      visible={!!setId}
      title={title}
      subtitle={
        set ? `${dayLabel(set.set_date)} · ${timeRange(set.start_time, set.end_time)} · ${durationLabel(set.start_time, set.end_time)}` : undefined
      }
      onClose={onClose}
      closeLabel={strings.set.close}
      testID="set-sheet"
    >
      {state.status === "loading" ? <SkeletonList label={strings.set.loading} inset={false} /> : null}

      {state.status === "error" ? (
        <Banner tone="error" testID="set-error" actionLabel={strings.errors.retry} onAction={retry}>
          {isForbidden(state.error) ? strings.errors.forbiddenBody : friendlyErrorOrMissing(state.error)}
        </Banner>
      ) : null}

      {set && ready ? (
        <>
          {/* ── identity ─────────────────────────── */}
          <View style={{ gap: space.sm }}>
            {band || set.status !== "scheduled" || set.series_id ? (
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {band ? <BandChip label={band} /> : null}
                {set.status !== "scheduled" ? (
                  <StatusChip
                    label={set.status.charAt(0).toUpperCase() + set.status.slice(1)}
                    variant={set.status === "cancelled" ? "danger" : "quiet"}
                  />
                ) : null}
                {set.series_id ? <StatusChip label={strings.set.repeats} icon={Repeat} /> : null}
              </View>
            ) : null}
            <Text variant="caption" tone="secondary">
              {[set.owner ? strings.set.setUpBy(fullName(set.owner)) : null, leadLine ? strings.set.ledBy(leadLine) : strings.set.noLead]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>

          {set.relocation_note ? (
            <Banner tone="info" icon={MapPin}>
              {strings.set.relocated(set.relocation_note)}
            </Banner>
          ) : null}

          <ActionNotice result={result} />

          {/* ── what we're praying ───────────────── */}
          {set.prayer_focus || set.theme || set.scripture ? (
            <View style={{ gap: space.xs }}>
              <LabelRow label={strings.set.praying} />
              <Text variant="caption">{set.prayer_focus ?? strings.set.nothingWritten}</Text>
              {set.theme || set.scripture ? (
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: space.xs }}>
                  {[set.theme, set.scripture].filter((t): t is string => !!t).map((t) => (
                    // A tag, not a status: the word is the whole meaning.
                    <StatusChip key={t} label={t} variant="quiet" icon={null} />
                  ))}
                </View>
              ) : null}
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
            <View style={{ gap: space.xs, padding: space.md, borderRadius: radius.card, backgroundColor: colors.surface }}>
              <LabelRow label={strings.set.walkIn} />
              <Text variant="caption">{set.setlist}</Text>
            </View>
          ) : null}

          {canManageSet(set, userId, access) ? (
            <ListGroup inset={false}>
              <ListRow
                title={strings.set.manageOnWeb}
                trailing="web"
                onPress={() => openWebPage("/prayer-room", colors)}
                testID="manage-on-web"
              />
            </ListGroup>
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
            variant="label"
            tone={lead ? "default" : "secondary"}
            // A floor, not a fixed width: at large text sizes the seat name
            // may take more room instead of breaking mid-word.
            style={{ minWidth: 96, maxWidth: "45%", flexShrink: 1, paddingTop: 2, ...(lead ? { fontFamily: fontFamily.bodyBold } : null) }}
          >
            {label}
          </Text>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            {empty ? (
              <Text variant="caption" tone="secondary">
                {strings.set.nobody}
                {slot.required_label ? ` · ${slot.required_label.name}` : ""}
              </Text>
            ) : (
              <>
                <Text variant="sectionTitle">{me || invitedMe ? strings.set.you : displayName(person)}</Text>
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
              size="small"
              onPress={() => onAccept(slot)}
              loading={busy === slot.id}
              disabled={!!busy}
              accessibilityLabel={`${strings.set.accept} ${label}`}
            />
            <Button
              label={strings.set.decline}
              variant="secondary"
              size="small"
              onPress={() => onDecline(slot)}
              disabled={!!busy}
              accessibilityLabel={`${strings.set.decline} ${label}`}
            />
          </View>
        ) : null}

        {empty && !canManage && set.status === "scheduled" ? (
          asked.has(seatKey) ? (
            <StatusChip label={strings.set.asked} icon={Clock} testID={`asked-${slot.id}`} />
          ) : (
            <View style={{ flexDirection: "row" }}>
              <Button
                label={strings.set.askToJoin}
                variant="secondary"
                size="small"
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
    <View style={{ gap: space.xs }}>
      <LabelRow label={strings.set.lineup} right={strings.set.openSeats(c.open, c.total)} />
      {set.slots.length === 0 ? (
        <Text variant="caption" tone="secondary">
          {strings.set.noSeats}
        </Text>
      ) : null}
      {leads.map((s) => row(s, true))}
      {leads.length > 0 && others.length > 0 ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: 2, backgroundColor: colors.text, marginVertical: space.xs }}
        />
      ) : null}
      {others.map((s) => row(s, false))}
    </View>
  );
}
