import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { Banner, Button, Masthead } from "@/components";

import type { MyRegistration, MyTicket } from "../api";
import { SectionBar, SavedCue } from "../components/SectionBar";
import { EmptyState, ErrorState, SkeletonRows } from "../components/StateViews";
import { RegistrationRow, TicketRow } from "../components/TicketRow";
import { TicketsScreen } from "../components/TicketsScreen";
import { formatStamp, splitByWhen } from "../dates";
import { useMe, useMyTickets, useOnline } from "../hooks";
import { canRunCheckIn } from "../permissions";
import { strings } from "../strings";

type Item = { kind: "ticket"; ticket: MyTicket; event: MyTicket["event"] } | { kind: "registration"; registration: MyRegistration; event: MyRegistration["event"] };

export function MyTicketsScreen({ now = () => new Date() }: { now?: () => Date }) {
  const router = useRouter();
  const me = useMe();
  const online = useOnline();
  const t = useMyTickets();
  const [showPast, setShowPast] = useState(false);

  const renderItem = (item: Item) =>
    item.kind === "ticket" ? (
      <TicketRow key={`t-${item.ticket.id}`} ticket={item.ticket} onPress={() => router.push(`/tickets/ticket/${encodeURIComponent(item.ticket.id)}`)} />
    ) : (
      <RegistrationRow key={`r-${item.registration.id}`} registration={item.registration} />
    );

  let body: ReactNode = null;
  if (t.status === "loading") {
    body = <SkeletonRows label={strings.myTickets.loading} />;
  } else if (t.status === "error") {
    body = <ErrorState title={strings.myTickets.errorTitle} message={t.message} onRetry={() => void t.refresh()} />;
  } else {
    const items: Item[] = [
      ...t.data.tickets.map((ticket) => ({ kind: "ticket" as const, ticket, event: ticket.event })),
      ...t.data.registrations.map((registration) => ({ kind: "registration" as const, registration, event: registration.event })),
    ];
    const { upcoming, past } = splitByWhen(items, now());
    const when = formatStamp(t.savedAt);
    const showStale = t.stale && (!online || t.refreshError !== null) && !!t.savedAt;
    // The one yellow band, only from real data: an upcoming ticket whose
    // event needs a waiver that hasn't been signed.
    const needsWaiver = upcoming.filter(
      (i): i is Extract<Item, { kind: "ticket" }> =>
        i.kind === "ticket" && i.ticket.status !== "void" && i.ticket.waiver.required && !i.ticket.waiver.signed,
    );

    body = (
      <>
        {showStale ? (
          <Banner tone="info" title={strings.common.offline} testID="stale-banner">
            {online ? strings.myTickets.refreshFailedShowingSaved(when) : strings.myTickets.offlineShowingSaved(when)}
          </Banner>
        ) : null}
        {needsWaiver.length > 0 ? (
          <Banner tone="needsYou" title={strings.myTickets.needsYou} testID="needs-you">
            {`${needsWaiver.map((i) => i.ticket.event.title).join(", ")}: ${strings.ticket.waiverMissing}`}
          </Banner>
        ) : null}
        {items.length === 0 ? (
          <EmptyState title={strings.myTickets.emptyTitle} body={strings.myTickets.emptyBody} />
        ) : (
          <>
            {t.data.tickets.length > 0 ? <SavedCue text={strings.myTickets.savedOnPhone} hint={strings.myTickets.savedOnPhoneHint} /> : null}
            {upcoming.length > 0 ? (
              <View>
                <SectionBar title={strings.myTickets.upcoming} meta={String(upcoming.length)} />
                {upcoming.map(renderItem)}
              </View>
            ) : null}
            {past.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Button
                  label={showPast ? strings.myTickets.hidePast : strings.myTickets.showPast(past.length)}
                  variant="ghost"
                  accessibilityState={{ expanded: showPast }}
                  onPress={() => setShowPast((s) => !s)}
                  style={{ alignSelf: "flex-start" }}
                />
                {showPast ? (
                  <View testID="past-list">
                    <SectionBar title={strings.myTickets.past} meta={String(past.length)} />
                    {past.map(renderItem)}
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </>
    );
  }

  return (
    <TicketsScreen edges={["top", "bottom"]} onRefresh={() => void t.refresh()} refreshing={t.refreshing}>
      <Masthead context={strings.myTickets.context} title={strings.myTickets.title} />
      {me.status === "ready" && canRunCheckIn(me.me) ? (
        <Button
          label={strings.myTickets.runCheckIn}
          accessibilityHint={strings.myTickets.runCheckInHint}
          variant="secondary"
          onPress={() => router.push("/tickets/check-in")}
        />
      ) : null}
      {body}
    </TicketsScreen>
  );
}
