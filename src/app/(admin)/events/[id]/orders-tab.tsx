"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  formatAnswerValue,
  type CheckoutAnswerSnapshot,
} from "@/lib/ticketing/checkout-questions";
import { OrdersExportPanel } from "./orders-export-panel";
import { RefundDialog } from "./refund-dialog";
import { RefundAllButton } from "./refund-all-button";
import { CancellationNoticeButton } from "./cancellation-notice-button";
import { PersonQuickView } from "@/components/people/person-quick-view";
import type { PersonRef } from "@/services/person-quick-view";
import { formatMoney } from "@/lib/currencies";

type Order = {
  id: string;
  status: string;
  buyer_first_name: string;
  buyer_last_name: string;
  buyer_email: string;
  total_cents: number;
  refund_cents: number;
  paid_at: string | null;
  created_at: string;
  contact_resolution: string;
  custom_answers?: unknown;
  // Issued tickets + their per-ticket answers (migration 137). Present
  // once the order is paid and fulfilled.
  tickets?: TicketWithAnswers[] | null;
  payment_provider: string | null;
  provider_payment_id: string | null;
  // Snapshotted from events.currency at checkout, so an order always
  // renders in the currency it was actually sold in.
  currency: string | null;
};

type TicketWithAnswers = {
  id: string;
  ticket_type_id: string;
  custom_answers?: unknown;
  ticket_types?: { name: string } | null;
};

// Latest ticket-confirmation email delivery state per order (migration
// 141). status advances queued → sent → delivered / opened, or lands on
// bounced / complained / failed / dropped.
export type TicketEmailStatus = {
  id: string;
  order_id: string;
  to_email: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  created_at: string;
};

export type OrderRefund = {
  id: string;
  order_id: string;
  amount_cents: number;
  reason: string | null;
  method: string;
  provider: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  users?: { first_name: string | null; last_name: string | null } | null;
};

// Orders that took money at some point — the denominator for revenue.
// A refunded order still belongs in gross revenue; netting it out twice
// (excluded from revenue AND subtracted as a refund) understated Net.
const EVER_PAID = ["paid", "partially_refunded", "refunded"];

function answersForOrder(o: Order): CheckoutAnswerSnapshot[] {
  return Array.isArray(o.custom_answers)
    ? (o.custom_answers as CheckoutAnswerSnapshot[])
    : [];
}

// Issued tickets that actually collected per-tier answers, each with its
// tier name and answer snapshot. Empty when no ticket carried questions.
function ticketAnswersForOrder(o: Order): Array<{
  id: string;
  tierName: string;
  answers: CheckoutAnswerSnapshot[];
}> {
  return (o.tickets ?? [])
    .map((t) => ({
      id: t.id,
      tierName: t.ticket_types?.name ?? "Ticket",
      answers: Array.isArray(t.custom_answers)
        ? (t.custom_answers as CheckoutAnswerSnapshot[])
        : [],
    }))
    .filter((t) => t.answers.length > 0);
}

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "outline",
  paid: "default",
  expired: "secondary",
  cancelled: "destructive",
  refunded: "destructive",
  partially_refunded: "destructive",
};

export function OrdersTab({
  eventId,
  orders,
  refunds = [],
  ticketEmails = [],
  currency,
  eventStatus,
  hasCancellationMessage = false,
}: {
  eventId: string;
  orders: Order[];
  refunds?: OrderRefund[];
  ticketEmails?: TicketEmailStatus[];
  // The event's selling currency — used for the aggregate stat cards.
  // Individual rows prefer the order's own snapshot.
  currency: string;
  // Lifecycle status + whether a cancellation reason is saved — gate the
  // "email cancellation reason" action to cancelled events.
  eventStatus?: string;
  hasCancellationMessage?: boolean;
}) {
  const router = useRouter();
  const money = (cents: number, c?: string | null) =>
    formatMoney(cents, c ?? currency);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [quickPerson, setQuickPerson] = useState<PersonRef | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [recentlySentId, setRecentlySentId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refundOrder, setRefundOrder] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const everPaid = orders.filter((o) => EVER_PAID.includes(o.status));
  const stillPaid = orders.filter(
    (o) => o.status === "paid" || o.status === "partially_refunded"
  );
  const totalRevenueCents = everPaid.reduce((s, o) => s + o.total_cents, 0);
  const totalRefundedCents = everPaid.reduce((s, o) => s + o.refund_cents, 0);
  const netCents = totalRevenueCents - totalRefundedCents;
  // Money still sitting on refundable orders — the "refund all" target.
  const outstandingCents = stillPaid.reduce(
    (s, o) => s + (o.total_cents - o.refund_cents),
    0
  );

  const refundsByOrder = new Map<string, OrderRefund[]>();
  for (const r of refunds) {
    const list = refundsByOrder.get(r.order_id) ?? [];
    list.push(r);
    refundsByOrder.set(r.order_id, list);
  }

  // ticketEmails arrive newest-first, so the first row seen for an order
  // is its latest confirmation-email attempt — the one worth showing.
  const emailByOrder = new Map<string, TicketEmailStatus>();
  for (const e of ticketEmails) {
    if (!emailByOrder.has(e.order_id)) emailByOrder.set(e.order_id, e);
  }

  function settledRefundCents(orderId: string): number {
    return (refundsByOrder.get(orderId) ?? [])
      .filter((r) => r.status === "succeeded")
      .reduce((s, r) => s + r.amount_cents, 0);
  }

  // PayFast settles refunds asynchronously and never calls back, so a
  // pending row only advances when someone asks the provider.
  async function syncRefunds(order: Order) {
    setBusyId(order.id);
    setErr(null);
    const res = await fetch(
      `/api/events/${eventId}/orders/${order.id}/refund`,
      { method: "PATCH" }
    );
    setBusyId(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Could not check the refund status");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { updated?: number };
    toast.success(
      data.updated
        ? `${data.updated} refund${data.updated === 1 ? "" : "s"} updated.`
        : "Still pending at the provider."
    );
    router.refresh();
  }

  async function resendEmail(order: Order) {
    if (
      !confirm(
        `Re-send the ticket email for order #${order.id.slice(0, 8)} to ${order.buyer_email}?`
      )
    )
      return;
    setResendingId(order.id);
    setErr(null);
    const res = await fetch(
      `/api/events/${eventId}/orders/${order.id}/resend-email`,
      { method: "POST" }
    );
    setResendingId(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Resend failed");
      return;
    }
    setRecentlySentId(order.id);
    setTimeout(() => setRecentlySentId(null), 3000);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Paid orders" value={stillPaid.length.toString()} />
        <StatCard label="Revenue" value={money(totalRevenueCents)} />
        <StatCard
          label="Net (after refunds)"
          value={money(netCents)}
          sub={
            totalRefundedCents > 0
              ? `${money(totalRefundedCents)} refunded`
              : null
          }
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Orders</CardTitle>
          {orders.length > 0 && (
            <div className="flex items-center gap-2">
              {eventStatus === "cancelled" && (
                <CancellationNoticeButton
                  eventId={eventId}
                  hasCancellationMessage={hasCancellationMessage}
                />
              )}
              <RefundAllButton
                eventId={eventId}
                outstandingCount={stillPaid.length}
                outstandingCents={outstandingCents}
                formatMoney={(cents) => money(cents)}
              />
              <OrdersExportPanel eventId={eventId} />
            </div>
          )}
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No orders yet.
            </p>
          ) : (
            <>
              {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => {
                    const answers = answersForOrder(o);
                    const ticketAnswers = ticketAnswersForOrder(o);
                    const orderRefunds = refundsByOrder.get(o.id) ?? [];
                    const hasPending = orderRefunds.some(
                      (r) => r.status === "pending"
                    );
                    const expandable =
                      answers.length > 0 ||
                      ticketAnswers.length > 0 ||
                      orderRefunds.length > 0;
                    const expanded = expandedId === o.id;
                    return (
                    <Fragment key={o.id}>
                    <TableRow>
                      <TableCell className="font-mono text-xs">
                        {expandable ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedId(expanded ? null : o.id)
                            }
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            aria-expanded={expanded}
                            title={[
                              answers.length > 0
                                ? `${answers.length} checkout answer${answers.length === 1 ? "" : "s"}`
                                : null,
                              orderRefunds.length > 0
                                ? `${orderRefunds.length} refund${orderRefunds.length === 1 ? "" : "s"}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          >
                            <span className="text-muted-foreground">
                              {expanded ? "▾" : "▸"}
                            </span>
                            {o.id.slice(0, 8)}
                          </button>
                        ) : (
                          o.id.slice(0, 8)
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() =>
                            setQuickPerson({
                              email: o.buyer_email,
                              name: `${o.buyer_first_name} ${o.buyer_last_name}`.trim(),
                            })
                          }
                          className="text-sm hover:underline text-left"
                        >
                          {o.buyer_first_name} {o.buyer_last_name}
                        </button>
                        <div className="text-xs text-muted-foreground">
                          {o.buyer_email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{money(o.total_cents, o.currency)}</div>
                        {o.refund_cents > 0 && (
                          <div className="text-xs text-muted-foreground">
                            − {money(o.refund_cents, o.currency)} refunded
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={STATUS_VARIANTS[o.status]}
                          className="capitalize"
                        >
                          {o.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DeliveryBadge email={emailByOrder.get(o.id)} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {o.paid_at
                          ? new Date(o.paid_at).toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          {o.status === "paid" && (
                            <button
                              type="button"
                              onClick={() => resendEmail(o)}
                              disabled={
                                resendingId === o.id || busyId === o.id
                              }
                              className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50 disabled:no-underline normal-case tracking-normal"
                            >
                              {resendingId === o.id
                                ? "Sending…"
                                : recentlySentId === o.id
                                  ? "Sent"
                                  : "Resend email"}
                            </button>
                          )}
                          {/* Partially refunded orders still hold money,
                              so they stay refundable up to the balance. */}
                          {(o.status === "paid" ||
                            o.status === "partially_refunded") && (
                            <button
                              type="button"
                              onClick={() => setRefundOrder(o)}
                              disabled={
                                busyId === o.id || resendingId === o.id
                              }
                              className="text-xs text-red-600 hover:underline disabled:text-gray-300 disabled:no-underline normal-case tracking-normal"
                            >
                              Refund
                            </button>
                          )}
                          {hasPending && (
                            <button
                              type="button"
                              onClick={() => syncRefunds(o)}
                              disabled={busyId === o.id}
                              className="text-xs text-amber-600 hover:underline disabled:opacity-50 disabled:no-underline normal-case tracking-normal"
                            >
                              {busyId === o.id
                                ? "Checking…"
                                : "Check refund status"}
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && expandable && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30">
                          <div className="py-1 space-y-4">
                            {answers.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                  Checkout answers
                                </p>
                                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                                  {answers.map((a, i) => (
                                    <div key={a.id ?? i} className="flex flex-col">
                                      <dt className="text-xs text-muted-foreground">
                                        {a.label}
                                      </dt>
                                      <dd className="text-sm whitespace-pre-wrap">
                                        {formatAnswerValue(a.value) || "—"}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            )}
                            {ticketAnswers.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                  Per-ticket answers
                                </p>
                                <div className="space-y-3">
                                  {ticketAnswers.map((t, ti) => (
                                    <div
                                      key={t.id}
                                      className="rounded border bg-background/60 p-2"
                                    >
                                      <p className="text-xs font-medium mb-1">
                                        {t.tierName} · Ticket {ti + 1}
                                      </p>
                                      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                                        {t.answers.map((a, i) => (
                                          <div
                                            key={a.id ?? i}
                                            className="flex flex-col"
                                          >
                                            <dt className="text-xs text-muted-foreground">
                                              {a.label}
                                            </dt>
                                            <dd className="text-sm whitespace-pre-wrap">
                                              {formatAnswerValue(a.value) || "—"}
                                            </dd>
                                          </div>
                                        ))}
                                      </dl>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {orderRefunds.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                  Refunds
                                </p>
                                <ul className="space-y-1.5">
                                  {orderRefunds.map((r) => (
                                    <li
                                      key={r.id}
                                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                                    >
                                      <span className="font-medium text-sm">
                                        {money(r.amount_cents, o.currency)}
                                      </span>
                                      <Badge
                                        variant={
                                          r.status === "succeeded"
                                            ? "secondary"
                                            : r.status === "failed"
                                              ? "destructive"
                                              : "outline"
                                        }
                                        className="capitalize"
                                      >
                                        {r.status}
                                      </Badge>
                                      <span className="text-muted-foreground">
                                        {r.method === "manual"
                                          ? "recorded manually"
                                          : `via ${r.provider ?? "provider"}`}
                                        {" · "}
                                        {new Date(
                                          r.created_at
                                        ).toLocaleString()}
                                        {r.users?.first_name
                                          ? ` · ${r.users.first_name} ${r.users.last_name ?? ""}`.trimEnd()
                                          : ""}
                                      </span>
                                      {r.reason && (
                                        <span className="basis-full text-muted-foreground italic">
                                          “{r.reason}”
                                        </span>
                                      )}
                                      {r.error_message && (
                                        <span className="basis-full text-red-600">
                                          {r.error_message}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {refundOrder && (
        <RefundDialog
          eventId={eventId}
          order={refundOrder}
          alreadyRefundedCents={settledRefundCents(refundOrder.id)}
          open={true}
          onOpenChange={(open) => {
            if (!open) setRefundOrder(null);
          }}
        />
      )}

      <PersonQuickView
        personRef={quickPerson}
        onClose={() => setQuickPerson(null)}
      />
    </div>
  );
}

// Confirmation-email delivery at a glance. Distinguishes the states that
// matter operationally: delivered/opened (good), bounced/complained/failed
// (needs attention), sent (accepted by provider, awaiting a delivery
// webhook), and "—" when there's no ledger row yet (e.g. before migration
// 141 is applied, or an order that predates it).
function DeliveryBadge({ email }: { email?: TicketEmailStatus }) {
  if (!email) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const map: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    delivered: { label: "Delivered", variant: "secondary" },
    opened: { label: "Opened", variant: "secondary" },
    sent: { label: "Sent", variant: "outline" },
    queued: { label: "Queued", variant: "outline" },
    bounced: { label: "Bounced", variant: "destructive" },
    complained: { label: "Spam", variant: "destructive" },
    dropped: { label: "Dropped", variant: "destructive" },
    failed: { label: "Failed", variant: "destructive" },
  };
  const meta = map[email.status] ?? { label: email.status, variant: "outline" as const };
  const when =
    email.delivered_at ??
    email.opened_at ??
    email.bounced_at ??
    email.complained_at ??
    email.sent_at ??
    email.created_at;
  const title = [
    `${meta.label} → ${email.to_email}`,
    when ? new Date(when).toLocaleString() : null,
    email.error ? `Reason: ${email.error}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Badge variant={meta.variant} className="cursor-default" title={title}>
      {meta.label}
    </Badge>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}
