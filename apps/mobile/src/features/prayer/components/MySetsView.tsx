import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { Banner, Button, Text } from "@/components";
import { ListRow, SectionBar, SkeletonRows, StateMessage, openWebPage } from "@/features/shell";
import { useTheme } from "@/theme/use-theme";

import { respondToInvite, type Invite } from "../api";
import { prayerFetch } from "../api-client";
import { useAction, useCommitments, useWallMeta, type ActionResult } from "../hooks";
import {
  dayLabel,
  friendlyError,
  fullName,
  isForbidden,
  sastToday,
  seatLabel,
  setTitle,
  spokenDate,
  spokenTimeRange,
  timeRange,
  type PrayerAccess,
} from "../logic";
import { strings } from "../strings";

import { Frame } from "./Frame";
import { SetSheet } from "./SetSheet";
import { ActionNotice, ErrorState } from "./ui";

/**
 * My commitments (the web's "My sets" tab, frame 11b's "Mine"): invitations
 * waiting on an answer, the sets I set up, and the sets I'm serving in. The
 * yellow band here is the invitations, the one thing waiting on this person.
 */
export function MySetsView({
  nav,
  userId,
  access,
  now,
}: {
  nav: ReactNode;
  userId: string | null;
  access: PrayerAccess;
  now: () => Date;
}) {
  const { colors } = useTheme();
  const { state, reload, retry, refreshing } = useCommitments(true);
  const meta = useWallMeta(true);
  const { busy, run } = useAction();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const today = sastToday(now());
  const seatTypes = meta.state.status === "ready" ? meta.state.data.seatTypes : [];
  const bands = meta.state.status === "ready" ? meta.state.data.bands : [];

  const respond = async (inv: Invite, action: "accept" | "decline") => {
    const label = seatLabel(inv, seatTypes);
    const when = inv.set ? `${spokenDate(inv.set.set_date)}, ${spokenTimeRange(inv.set.start_time, inv.set.end_time)}` : "";
    const r = await run(
      inv.id,
      action === "accept"
        ? {
            title: strings.set.confirmAcceptTitle,
            body: strings.set.confirmAcceptBody(label, when),
            confirm: strings.set.accept,
            cancel: strings.set.cancel,
          }
        : {
            title: strings.set.confirmDeclineTitle,
            body: strings.set.confirmDeclineBody,
            confirm: strings.set.decline,
            cancel: strings.set.cancel,
            destructive: true,
          },
      () => respondToInvite(prayerFetch, inv.id, action),
      action === "accept" ? strings.set.accepted : strings.set.declined,
    );
    if (!r) return;
    setResult(r);
    await reload();
  };

  const more = (
    <View>
      <SectionBar label={strings.mine.more} />
      <ListRow title={strings.mine.join} trailing="web" onPress={() => openWebPage("/prayer-room", colors)} testID="join-on-web" />
      {access.showEvaluatorTools ? (
        <ListRow
          title={strings.mine.evaluator}
          trailing="web"
          onPress={() => openWebPage("/prayer-room", colors)}
          testID="evaluator-tools"
        />
      ) : null}
    </View>
  );

  if (state.status === "loading") {
    return (
      <Frame context={strings.segments.mine} nav={nav}>
        <SkeletonRows count={4} label={strings.mine.loading} />
      </Frame>
    );
  }

  if (state.status === "error") {
    return (
      <Frame context={strings.segments.mine} nav={nav} onRefresh={retry}>
        {isForbidden(state.error) ? (
          <StateMessage title={strings.errors.forbiddenTitle} body={strings.errors.forbiddenBody} testID="forbidden" />
        ) : (
          <ErrorState message={friendlyError(state.error)} onRetry={retry} />
        )}
        {more}
      </Frame>
    );
  }

  const { invites, owned, roster } = state.data;
  const leading = owned.filter((s) => s.set_date >= today && s.status === "scheduled");
  const serving = roster.filter((r) => r.set && r.set.set_date >= today && r.set.status !== "cancelled");

  return (
    <Frame context={strings.segments.mine} nav={nav} onRefresh={reload} refreshing={refreshing}>
      {invites.length > 0 ? (
        <Banner tone="needsYou" testID="invites-band">
          {strings.mine.invitationsBand(invites.length)}
        </Banner>
      ) : null}
      <ActionNotice result={result} />

      <View>
        <SectionBar label={strings.mine.invitations} />
        {invites.length === 0 ? <Text tone="secondary" style={{ paddingVertical: 12 }}>{strings.mine.noInvitations}</Text> : null}
        {invites.map((inv) => {
          const label = seatLabel(inv, seatTypes);
          const s = inv.set;
          return (
            <View key={inv.id} testID={`invite-${inv.id}`} style={{ paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.rule }}>
              <View
                accessible
                accessibilityLabel={
                  s
                    ? `${label} on ${setTitle(s)}, ${spokenDate(s.set_date)}, ${spokenTimeRange(s.start_time, s.end_time)}${s.owner ? `, from ${fullName(s.owner)}` : ""}`
                    : label
                }
              >
                <Text variant="bodyStrong">{s ? strings.mine.roleOn(label, setTitle(s)) : label}</Text>
                {s ? (
                  <Text variant="caption" tone="secondary">
                    {dayLabel(s.set_date)} · {timeRange(s.start_time, s.end_time)}
                    {s.owner ? ` · ${fullName(s.owner)}` : ""}
                  </Text>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button
                  label={strings.set.accept}
                  onPress={() => respond(inv, "accept")}
                  loading={busy === inv.id}
                  disabled={!!busy}
                  accessibilityLabel={`${strings.set.accept} ${label}`}
                />
                <Button
                  label={strings.set.decline}
                  variant="secondary"
                  onPress={() => respond(inv, "decline")}
                  disabled={!!busy}
                  accessibilityLabel={`${strings.set.decline} ${label}`}
                />
              </View>
            </View>
          );
        })}
      </View>

      <View>
        <SectionBar label={strings.mine.serving} />
        {serving.length === 0 ? <Text tone="secondary" style={{ paddingVertical: 12 }}>{strings.mine.noServing}</Text> : null}
        {serving.map((r) => (
          <ListRow
            key={r.id}
            testID={`serving-${r.id}`}
            title={strings.mine.roleOn(seatLabel(r, seatTypes), setTitle(r.set!))}
            subtitle={`${dayLabel(r.set!.set_date)} · ${timeRange(r.set!.start_time, r.set!.end_time)}`}
            accessibilityHint={strings.set.openHint}
            onPress={() => setOpenId(r.set!.id)}
          />
        ))}
      </View>

      <View>
        <SectionBar label={strings.mine.leading} />
        {leading.length === 0 ? <Text tone="secondary" style={{ paddingVertical: 12 }}>{strings.mine.noLeading}</Text> : null}
        {leading.map((s) => (
          <ListRow
            key={s.id}
            testID={`leading-${s.id}`}
            title={setTitle(s)}
            subtitle={`${dayLabel(s.set_date)} · ${timeRange(s.start_time, s.end_time)}${s.series_id ? ` · ${strings.set.repeats}` : ""}`}
            accessibilityHint={strings.set.openHint}
            onPress={() => setOpenId(s.id)}
          />
        ))}
      </View>

      {more}

      <Text variant="caption" tone="secondary">
        {strings.mine.calendarLater}
      </Text>

      <SetSheet
        setId={openId}
        onClose={() => setOpenId(null)}
        onChanged={reload}
        seatTypes={seatTypes}
        bands={bands}
        userId={userId}
        access={access}
      />
    </Frame>
  );
}
