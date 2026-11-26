import * as WebBrowser from "expo-web-browser";
import { SearchX, X } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { Banner, Button, Divider, EmptyState, SkeletonList, Text, type BackAction } from "@/components";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { fontSize, space } from "@/theme/tokens";

import { getWaiverLink, type MyTicket } from "../api";
import { SavedCue } from "../components/ListHeader";
import { StatusTag } from "../components/TicketRow";
import { TicketQr } from "../components/TicketQr";
import { TicketsScreen } from "../components/TicketsScreen";
import { formatClock, formatDay, formatEventWhen } from "../dates";
import { isSignedOutError, useBrightnessBoost, useMyTickets } from "../hooks";
import { strings } from "../strings";

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ gap: 2 }}>
      <Text variant="label">{label}</Text>
      <Text style={{ fontSize: fontSize.sectionTitle, lineHeight: 22 }}>{value}</Text>
    </View>
  );
}

function Waiver({ ticket }: { ticket: MyTicket }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const w = ticket.waiver;
  if (!w.required && !w.signed) return null;

  async function open() {
    setOpening(true);
    setError(null);
    try {
      const { url } = await getWaiverLink(apiFetch, ticket.code);
      await WebBrowser.openBrowserAsync(url);
    } catch (err) {
      if (!isSignedOutError(err)) setError(err instanceof ApiError && err.kind !== "network" ? err.message : strings.ticket.waiverOpenFailed);
    } finally {
      setOpening(false);
    }
  }

  return (
    <View style={{ gap: space.sm }} testID="waiver">
      <Detail
        label={w.title ? `${strings.ticket.waiver} · ${w.title}` : strings.ticket.waiver}
        value={w.signed && w.signedAt ? strings.ticket.waiverSigned(formatDay(w.signedAt.slice(0, 10))) : strings.ticket.waiverMissing}
      />
      {w.hasDocument ? (
        <Button
          label={strings.ticket.viewWaiver}
          accessibilityHint={strings.ticket.viewWaiverHint}
          variant="secondary"
          loading={opening}
          onPress={() => void open()}
        />
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type Props = {
  ticketId: string;
  /** Back to My tickets (the route supplies it). */
  onBack?: () => void;
};

/**
 * One ticket, full screen (no tab bar): the event as the hero title, the QR
 * on white in both schemes, the code in mono, then the details. Brightness
 * goes up while a scannable ticket is showing.
 */
export function TicketDetailScreen({ ticketId, onBack }: Props) {
  const t = useMyTickets();
  const ticket = t.status === "ready" ? t.data.tickets.find((x) => x.id === ticketId) ?? null : null;
  useBrightnessBoost(!!ticket && ticket.status !== "void");
  const back: BackAction | undefined = onBack ? { label: strings.myTickets.title, onPress: onBack } : undefined;

  if (t.status === "loading") {
    return (
      <TicketsScreen title={strings.ticket.title} back={back} bottomInset>
        <SkeletonList inset={false} count={1} label={strings.myTickets.loading} />
      </TicketsScreen>
    );
  }
  if (t.status === "error") {
    return (
      <TicketsScreen title={strings.ticket.title} back={back} bottomInset onRefresh={() => void t.refresh()} refreshing={t.refreshing}>
        <Banner tone="error" title={strings.myTickets.errorTitle} testID="error-state" actionLabel={strings.myTickets.retry} onAction={() => void t.refresh()}>
          {t.message}
        </Banner>
      </TicketsScreen>
    );
  }
  if (!ticket) {
    return (
      <TicketsScreen title={strings.ticket.title} back={back} bottomInset onRefresh={() => void t.refresh()} refreshing={t.refreshing}>
        <EmptyState icon={SearchX} title={strings.ticket.notFoundTitle} body={strings.ticket.notFoundBody} testID="empty-state" />
      </TicketsScreen>
    );
  }

  const voided = ticket.status === "void";
  const checkedAt = ticket.status === "checked_in" ? formatClock(ticket.checkedInAt) : null;

  return (
    <TicketsScreen
      eyebrow={strings.ticket.title}
      title={ticket.event.title}
      hero
      back={back}
      bottomInset
      onRefresh={() => void t.refresh()}
      refreshing={t.refreshing}
    >
      <StatusTag status={ticket.status} />

      {voided ? (
        <Banner tone="error" icon={X} title={strings.status.void}>
          {strings.ticket.voidNote}
        </Banner>
      ) : (
        <Text variant="label" style={{ textAlign: "center" }}>
          {strings.ticket.showAtDoor}
        </Text>
      )}

      <TicketQr code={ticket.code} dimmed={voided} />

      {checkedAt ? <Text style={{ textAlign: "center" }}>{strings.ticket.checkedInAt(checkedAt)}</Text> : null}
      <View style={{ alignItems: "center", gap: space.xs }}>
        {t.savedAt ? <SavedCue centered text={strings.myTickets.savedOnPhone} hint={strings.myTickets.savedOnPhoneHint} /> : null}
        {!voided ? (
          <Text variant="caption" tone="secondary" style={{ textAlign: "center" }}>
            {strings.ticket.brightnessNote}
          </Text>
        ) : null}
      </View>

      <Divider strong />
      <Detail label={strings.ticket.when} value={formatEventWhen(ticket.event)} />
      <Detail label={strings.ticket.where} value={ticket.event.location ?? strings.ticket.locationTbc} />
      <Detail label={strings.ticket.type} value={ticket.ticketTypeName} />
      {ticket.holderName ? <Detail label={strings.myTickets.holder} value={ticket.holderName} /> : null}
      <Waiver ticket={ticket} />
    </TicketsScreen>
  );
}
