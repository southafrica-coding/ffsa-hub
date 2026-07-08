"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
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
  xero_invoice_number?: string | null;
  xero_invoice_id?: string | null;
};

function answersForOrder(o: Order): CheckoutAnswerSnapshot[] {
  return Array.isArray(o.custom_answers)
    ? (o.custom_answers as CheckoutAnswerSnapshot[])
    : [];
}

function rands(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
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
}: {
  eventId: string;
  orders: Order[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [recentlySentId, setRecentlySentId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const paid = orders.filter((o) => o.status === "paid");
  const refunded = orders.filter(
    (o) => o.status === "refunded" || o.status === "partially_refunded"
  );
  const totalRevenueCents = paid.reduce((s, o) => s + o.total_cents, 0);
  const totalRefundedCents = refunded.reduce((s, o) => s + o.refund_cents, 0);
  const netCents = totalRevenueCents - totalRefundedCents;

  async function refund(order: Order) {
    if (
      !confirm(
        `Refund order #${order.id.slice(0, 8)} for ${rands(order.total_cents)} to ${order.buyer_email}?\n\n` +
          `This marks the order refunded, voids its tickets, and releases the inventory. ` +
          `You must process the actual money refund in PayFast separately.`
      )
    )
      return;
    setBusyId(order.id);
    setErr(null);
    const res = await fetch(
      `/api/events/${eventId}/orders/${order.id}/refund`,
      { method: "POST" }
    );
    setBusyId(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Refund failed");
      return;
    }
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
        <StatCard label="Paid orders" value={paid.length.toString()} />
        <StatCard label="Revenue" value={rands(totalRevenueCents)} />
        <StatCard
          label="Net (after refunds)"
          value={rands(netCents)}
          sub={
            totalRefundedCents > 0
              ? `${rands(totalRefundedCents)} refunded`
              : null
          }
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Orders</CardTitle>
          {orders.length > 0 && <OrdersExportPanel eventId={eventId} />}
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
                    <TableHead>Paid</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => {
                    const answers = answersForOrder(o);
                    const expanded = expandedId === o.id;
                    return (
                    <Fragment key={o.id}>
                    <TableRow>
                      <TableCell className="font-mono text-xs">
                        {answers.length > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedId(expanded ? null : o.id)
                            }
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            aria-expanded={expanded}
                            title={`${answers.length} checkout answer${answers.length === 1 ? "" : "s"}`}
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
                        <div className="text-sm">
                          {o.buyer_first_name} {o.buyer_last_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {o.buyer_email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{rands(o.total_cents)}</div>
                        {o.refund_cents > 0 && (
                          <div className="text-xs text-muted-foreground">
                            − {rands(o.refund_cents)} refunded
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
                      <TableCell className="text-xs text-muted-foreground">
                        {o.paid_at
                          ? new Date(o.paid_at).toLocaleString()
                          : "—"}
                        {o.xero_invoice_number && (
                          <div className="text-[11px] text-muted-foreground/80">
                            Xero: {o.xero_invoice_number}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {o.status === "paid" && (
                          <div className="flex flex-col items-end gap-1">
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
                            <button
                              type="button"
                              onClick={() => refund(o)}
                              disabled={
                                busyId === o.id || resendingId === o.id
                              }
                              className="text-xs text-red-600 hover:underline disabled:text-gray-300 disabled:no-underline normal-case tracking-normal"
                            >
                              {busyId === o.id ? "Refunding…" : "Refund"}
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded && answers.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/30">
                          <div className="py-1 space-y-2">
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
    </div>
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
