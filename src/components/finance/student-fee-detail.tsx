"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatZAR } from "@/lib/finance/billing";
import type { StudentBalance } from "@/lib/finance/student-balance";
import type { ChargeDetail } from "@/services/school-balances";
import { StatusPill, type Tone } from "@/components/ffsa";
import { FeeProgressBar } from "@/components/finance/fee-progress-bar";

// One student's fees: the bar, then every charge on their schedule — due
// date, invoice, status and what's been paid against it. Finance can invoice
// any not-yet-invoiced charge now, alone or several together as one invoice
// (late joiners, students paying ahead).

const INVOICEABLE = new Set(["scheduled", "needs_decision"]);

type Preview = {
  invoices: number;
  total: number;
  charges: Array<{ label: string; amount: number; dueDate: string }>;
  willEmail: boolean;
  template: string | null;
};

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function chargeState(c: ChargeDetail, today: string): { label: string; tone: Tone } {
  const owing = c.amount_zar - c.amount_paid_zar;
  switch (c.status) {
    case "paid":
      return { label: "Paid", tone: "good" };
    case "cancelled":
      return { label: "Cancelled", tone: "quiet" };
    case "needs_decision":
      return { label: "Held", tone: "warn" };
    case "scheduled":
      return { label: "Not invoiced yet", tone: "quiet" };
    default: {
      if (c.amount_paid_zar > 0 && owing > 0) {
        return { label: c.due_date < today ? "Part-paid · overdue" : "Part-paid", tone: c.due_date < today ? "bad" : "warn" };
      }
      if (c.due_date < today) return { label: "Overdue", tone: "bad" };
      return { label: c.status === "generated" ? "Invoiced (draft)" : "Invoiced", tone: "warn" };
    }
  }
}

export function StudentFeeDetail({
  balance,
  charges,
  today,
  enrollmentId,
  canEdit = false,
}: {
  balance: StudentBalance;
  charges: ChargeDetail[];
  today: string;
  enrollmentId?: string;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ ids: string[]; together: boolean; preview: Preview } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const actionable = canEdit && !!enrollmentId;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function call(ids: string[], together: boolean, preview: boolean) {
    const res = await fetch("/api/finance/school-fees/invoice-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrollmentId, chargeIds: ids, together, preview }),
    });
    return { ok: res.ok, json: await res.json() };
  }

  async function ask(ids: string[], together: boolean) {
    setBusy(together ? "together" : ids[0]);
    try {
      const { ok, json } = await call(ids, together, true);
      if (!ok) return toast.error(json.error || "Couldn't check those charges");
      setPending({ ids, together, preview: json });
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy("confirm");
    try {
      const { ok, json } = await call(pending.ids, pending.together, false);
      if (!ok) return toast.error(json.error || "Couldn't invoice");
      const made = (json.invoices ?? []) as Array<{ status: string; invoiceNumber?: string; error?: string }>;
      const failed = made.filter((i) => i.status === "failed" || i.error);
      if (failed.length) toast.error(failed.map((f) => f.error).join(" · "));
      const done = made.filter((i) => i.invoiceNumber).map((i) => `${i.invoiceNumber} (${i.status === "sent" ? "emailed" : "draft"})`);
      if (done.length) toast.success(`Invoiced: ${done.join(", ")}`);
      setPending(null);
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const selectedIds = [...selected];

  return (
    <section className="border border-ink bg-white">
      <div className="border-b border-rule px-4 py-3">
        <h2 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em]">Payments</h2>
        <FeeProgressBar balance={balance} />
      </div>
      {actionable && (
        <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-bone px-4 py-2 text-xs">
          <span className="text-[color:var(--text-secondary)]">
            Invoice any charge now instead of on its date — tick several to send them as one invoice.
          </span>
          {selectedIds.length > 0 && (
            <Button size="sm" disabled={busy !== null} onClick={() => ask(selectedIds, true)} className="ml-auto">
              {busy === "together" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Invoice {selectedIds.length} selected together
            </Button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-rule font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
              {actionable && <th className="w-8 py-2 pl-4" />}
              <th className="px-4 py-2">Charge</th>
              <th className="px-2 py-2">Due</th>
              <th className="px-2 py-2">Invoice</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-right">Paid</th>
              {actionable && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => {
              const s = chargeState(c, today);
              return (
                <tr key={c.id} className={`border-b border-rule last:border-0 ${c.status === "cancelled" ? "opacity-50" : ""}`}>
                  {actionable && (
                    <td className="py-2 pl-4">
                      {INVOICEABLE.has(c.status) && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.label}`}
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2">{c.label}</td>
                  <td className="whitespace-nowrap px-2 py-2">{fmtDate(c.due_date)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">
                    {c.xero_invoice_number ?? (
                      <span className="text-[color:var(--text-tertiary)]">
                        {c.status === "scheduled" ? `on ${fmtDate(c.scheduled_generation_date)}` : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <StatusPill tone={s.tone}>{s.label}</StatusPill>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono">{formatZAR(c.amount_zar)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono">
                    {c.amount_paid_zar > 0 ? formatZAR(c.amount_paid_zar) : "—"}
                    {c.paid_at && c.status === "paid" && (
                      <span className="block text-[10px] text-[color:var(--text-secondary)]">{fmtDate(c.paid_at)}</span>
                    )}
                  </td>
                  {actionable && (
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {INVOICEABLE.has(c.status) && (
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => ask([c.id], false)}>
                          {busy === c.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                          Invoice now
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pending?.preview.invoices === 1 ? "Send this invoice now?" : `Send ${pending?.preview.invoices} invoices now?`}
            </DialogTitle>
          </DialogHeader>
          {pending && (
            <div className="space-y-3 text-[13px]">
              <ul className="space-y-1">
                {pending.preview.charges.map((c, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      {c.label} <span className="text-[color:var(--text-secondary)]">· due {fmtDate(c.dueDate)}</span>
                    </span>
                    <span className="font-mono">{formatZAR(c.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-rule pt-2 font-semibold">
                {pending.together && pending.preview.charges.length > 1 ? "One invoice for " : "Total "}
                {formatZAR(pending.preview.total)}
              </p>
              <p className="text-xs text-[color:var(--text-secondary)]">
                {pending.preview.willEmail
                  ? `Created and approved in Xero now, and emailed to the student from the ${pending.preview.template ?? "default"} template.`
                  : "Created in Xero now as a draft — this school's invoice emails are held, so nobody is emailed."}{" "}
                Due dates stay as scheduled.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy === "confirm"}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={busy === "confirm"}>
              {busy === "confirm" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {pending?.preview.willEmail ? "Invoice and email now" : "Create draft now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
