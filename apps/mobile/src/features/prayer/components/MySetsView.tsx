import { Lock } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { Button, EmptyState, FadeIn, ListGroup, ListRow, NeedsYouBand, SectionHeader, SkeletonList, Text } from "@/components";
import { openWebPage } from "@/features/shell";
import { space } from "@/theme/tokens";
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

import { Frame, type PrayerNav } from "./Frame";
import { SetSheet } from "./SetSheet";
import { ActionNotice, ErrorState } from "./ui";

/** An empty section's one calm line. */
function Quiet({ children }: { children: string }) {
  return (
    <Text variant="caption" tone="secondary">
      {children}
    </Text>
  );
}

/**
 * My commitments (frame 4.7): invitations waiting on an answer, the sets I'm
 * serving in, the sets I set up, then what's on the website. The yellow band
 * here is the invitations, the one thing waiting on this person.
 */
export function MySetsView({
  nav,
  userId,
  access,
  now,
}: {
  nav: PrayerNav;
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
      <SectionHeader title={strings.mine.more} inset={false} tight />
      <ListGroup inset={false}>
        <ListRow title={strings.mine.join} trailing="web" onPress={() => openWebPage("/prayer-room", colors)} testID="join-on-web" />
        {access.showEvaluatorTools ? (
          <ListRow
            title={strings.mine.evaluator}
            trailing="web"
            onPress={() => openWebPage("/prayer-room", colors)}
            testID="evaluator-tools"
          />
        ) : null}
      </ListGroup>
    </View>
  );

  if (state.status === "loading") {
    return (
      <Frame nav={nav}>
        <SkeletonList count={4} label={strings.mine.loading} inset={false} />
      </Frame>
    );
  }

  if (state.status === "error") {
    return (
      <Frame nav={nav} onRefresh={retry}>
        {isForbidden(state.error) ? (
          <EmptyState icon={Lock} title={strings.errors.forbiddenTitle} body={strings.errors.forbiddenBody} testID="forbidden" />
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
    <Frame nav={nav} onRefresh={reload} refreshing={refreshing}>
      {invites.length > 0 ? (
        <NeedsYouBand testID="invites-band" eyebrow={strings.mine.needsYou} text={strings.mine.invitationsBand(invites.length)} />
      ) : null}
      <ActionNotice result={result} />

      <FadeIn style={{ gap: space.md }}>
        <View>
          <SectionHeader title={strings.mine.invitations} inset={false} tight />
          {invites.length === 0 ? (
            <Quiet>{strings.mine.noInvitations}</Quiet>
          ) : (
            <ListGroup inset={false}>
              {invites.map((inv) => {
                const label = seatLabel(inv, seatTypes);
                const s = inv.set;
                return (
                  <View key={inv.id} testID={`invite-${inv.id}`} style={{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.sm }}>
                    <View
                      accessible
                      accessibilityLabel={
                        s
                          ? `${label} on ${setTitle(s)}, ${spokenDate(s.set_date)}, ${spokenTimeRange(s.start_time, s.end_time)}${s.owner ? `, from ${fullName(s.owner)}` : ""}`
                          : label
                      }
                    >
                      <Text variant="rowTitle">{s ? strings.mine.roleOn(label, setTitle(s)) : label}</Text>
                      {s ? (
                        <Text variant="caption" tone="secondary">
                          {dayLabel(s.set_date)} · {timeRange(s.start_time, s.end_time)}
                          {s.owner ? ` · ${fullName(s.owner)}` : ""}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                      <Button
                        label={strings.set.accept}
                        size="small"
                        onPress={() => respond(inv, "accept")}
                        loading={busy === inv.id}
                        disabled={!!busy}
                        accessibilityLabel={`${strings.set.accept} ${label}`}
                      />
                      <Button
                        label={strings.set.decline}
                        variant="secondary"
                        size="small"
                        onPress={() => respond(inv, "decline")}
                        disabled={!!busy}
                        accessibilityLabel={`${strings.set.decline} ${label}`}
                      />
                    </View>
                  </View>
                );
              })}
            </ListGroup>
          )}
        </View>

        <View>
          <SectionHeader title={strings.mine.serving} inset={false} tight />
          {serving.length === 0 ? (
            <Quiet>{strings.mine.noServing}</Quiet>
          ) : (
            <ListGroup inset={false}>
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
            </ListGroup>
          )}
        </View>

        <View>
          <SectionHeader title={strings.mine.leading} inset={false} tight />
          {leading.length === 0 ? (
            <Quiet>{strings.mine.noLeading}</Quiet>
          ) : (
            <ListGroup inset={false}>
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
            </ListGroup>
          )}
        </View>
      </FadeIn>

      {more}

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
