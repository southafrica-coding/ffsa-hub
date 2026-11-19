import { useRouter } from "expo-router";
import { ScanLine, Ticket as TicketIcon } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { Banner, Button, EmptyState, FadeIn, ListGroup, ListRow, NeedsYouBand, SectionTitle, SkeletonList } from "@/components";
import { openWebPage, useMe } from "@/features/shell";
import { space } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import type { MyRegistration, MyTicket } from "../api";
import { SavedCue } from "../components/ListHeader";
import { RegistrationRow, TicketRow } from "../components/TicketRow";
import { TicketsScreen } from "../components/TicketsScreen";
import { formatStamp, splitByWhen } from "../dates";
import { useMyTickets, useOnline } from "../hooks";
import { canRunCheckIn } from "../permissions";
import { strings } from "../strings";
import { GET_TICKETS_WEB_PATH } from "../web";

type Item = { kind: "ticket"; ticket: MyTicket; event: MyTicket["event"] } | { kind: "registration"; registration: MyRegistration; event: MyRegistration["event"] };

export function MyTicketsScreen({ now = () => new Date() }: { now?: () => Date }) {
  const router = useRouter();
  const { colors } = useTheme();
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

  // Buying stays on the website: one row that says so, once there's a public
  // events page to send people to (see web.ts).
  const getTicketsPath = GET_TICKETS_WEB_PATH;
  const getTickets = getTicketsPath ? (
    <ListGroup inset={false} testID="get-tickets">
      <ListRow
        icon={TicketIcon}
        title={strings.myTickets.getTickets}
        subtitle={strings.myTickets.getTicketsBody}
        trailing="web"
        onPress={() => void openWebPage(getTicketsPath, colors)}
      />
    </ListGroup>
  ) : null;

  let body: ReactNode = null;
  if (t.status === "loading") {
    body = <SkeletonList inset={false} label={strings.myTickets.loading} />;
  } else if (t.status === "error") {
    body = (
      <Banner tone="error" title={strings.myTickets.errorTitle} testID="error-state" actionLabel={strings.myTickets.retry} onAction={() => void t.refresh()}>
        {t.message}
      </Banner>
    );
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
          <Banner tone="offline" title={strings.common.offline} testID="stale-banner">
            {online ? strings.myTickets.refreshFailedShowingSaved(when) : strings.myTickets.offlineShowingSaved(when)}
          </Banner>
        ) : null}
        {needsWaiver.length > 0 ? (
          <NeedsYouBand
            eyebrow={strings.myTickets.needsYou}
            text={`${needsWaiver.map((i) => i.ticket.event.title).join(", ")}: ${strings.ticket.waiverMissing}`}
            testID="needs-you"
          />
        ) : null}
        {items.length === 0 ? (
          <EmptyState icon={TicketIcon} title={strings.myTickets.emptyTitle} body={strings.myTickets.emptyBody} testID="empty-state" />
        ) : (
          <FadeIn style={{ gap: space.md }}>
            {t.data.tickets.length > 0 ? <SavedCue text={strings.myTickets.savedOnPhone} hint={strings.myTickets.savedOnPhoneHint} /> : null}
            {upcoming.length > 0 ? (
              <View>
                <SectionTitle title={strings.myTickets.upcoming} meta={upcoming.length} tight />
                <ListGroup inset={false}>{upcoming.map(renderItem)}</ListGroup>
              </View>
            ) : null}
            {past.length > 0 ? (
              <View>
                <Button
                  label={showPast ? strings.myTickets.hidePast : strings.myTickets.showPast(past.length)}
                  variant="text"
                  size="small"
                  accessibilityState={{ expanded: showPast }}
                  onPress={() => setShowPast((s) => !s)}
                  style={{ alignSelf: "flex-start" }}
                />
                {showPast ? (
                  <View testID="past-list">
                    <SectionTitle title={strings.myTickets.past} meta={past.length} tight />
                    <ListGroup inset={false}>{past.map(renderItem)}</ListGroup>
                  </View>
                ) : null}
              </View>
            ) : null}
          </FadeIn>
        )}
        {getTickets}
      </>
    );
  }

  return (
    <TicketsScreen
      eyebrow={strings.myTickets.context}
      title={strings.myTickets.title}
      onRefresh={() => void t.refresh()}
      refreshing={t.refreshing}
    >
      {me.status === "ready" && canRunCheckIn(me.me) ? (
        <Button
          label={strings.myTickets.runCheckIn}
          accessibilityHint={strings.myTickets.runCheckInHint}
          variant="secondary"
          icon={<ScanLine size={20} color={colors.text} />}
          onPress={() => router.push("/tickets/check-in")}
        />
      ) : null}
      {body}
    </TicketsScreen>
  );
}
