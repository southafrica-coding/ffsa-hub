import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";

import { Banner, Button, Divider, Text } from "@/components";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { getWaiverLink, type MyTicket } from "../api";
import { SavedCue } from "../components/SectionBar";
import { EmptyState, ErrorState, SkeletonRows } from "../components/StateViews";
import { StatusTag } from "../components/TicketRow";
import { TicketQr } from "../components/TicketQr";
import { TicketsScreen } from "../components/TicketsScreen";
import { formatClock, formatDay, formatEventWhen } from "../dates";
import { isSignedOutError, useBrightnessBoost, useMyTickets } from "../hooks";
import { strings } from "../strings";

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ gap: 2 }}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <Text>{value}</Text>
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
    <View style={{ gap: 8 }} testID="waiver">
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
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function TicketDetailScreen({ ticketId }: { ticketId: string }) {
  const t = useMyTickets();
  const ticket = t.status === "ready" ? t.data.tickets.find((x) => x.id === ticketId) ?? null : null;
  useBrightnessBoost(!!ticket && ticket.status !== "void");

  if (t.status === "loading") {
    return (
      <TicketsScreen>
        <SkeletonRows rows={1} label={strings.myTickets.loading} />
      </TicketsScreen>
    );
  }
  if (t.status === "error") {
    return (
      <TicketsScreen onRefresh={() => void t.refresh()} refreshing={t.refreshing}>
        <ErrorState title={strings.myTickets.errorTitle} message={t.message} onRetry={() => void t.refresh()} />
      </TicketsScreen>
    );
  }
  if (!ticket) {
    return (
      <TicketsScreen onRefresh={() => void t.refresh()} refreshing={t.refreshing}>
        <EmptyState title={strings.ticket.notFoundTitle} body={strings.ticket.notFoundBody} />
      </TicketsScreen>
    );
  }

  const checkedAt = ticket.status === "checked_in" ? formatClock(ticket.checkedInAt) : null;

  return (
    <TicketsScreen onRefresh={() => void t.refresh()} refreshing={t.refreshing}>
      <View style={{ gap: 6 }}>
        <Text variant="title">{ticket.event.title}</Text>
        <StatusTag status={ticket.status} />
      </View>

      {ticket.status === "void" ? (
        <Banner tone="danger" title={strings.status.void}>
          {strings.ticket.voidNote}
        </Banner>
      ) : (
        <Text variant="label" tone="secondary" style={{ textAlign: "center" }}>
          {strings.ticket.showAtDoor}
        </Text>
      )}

      <TicketQr code={ticket.code} dimmed={ticket.status === "void"} />

      {checkedAt ? <Text style={{ textAlign: "center" }}>{strings.ticket.checkedInAt(checkedAt)}</Text> : null}
      <View style={{ alignItems: "center", gap: 4 }}>
        {t.savedAt ? <SavedCue text={strings.myTickets.savedOnPhone} hint={strings.myTickets.savedOnPhoneHint} /> : null}
        {ticket.status !== "void" ? (
          <Text variant="caption" tone="secondary">
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
