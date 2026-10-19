"use client";

// Extend · Report an issue · Invoice (frame 47a-6), and Cancel for a request
// still waiting on the rental manager (46e right).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { addDays } from "@/lib/equipment/dates";

type Panel = null | "extend" | "issue" | "invoice";

export function RentalActions({
  token,
  status,
  internal,
  endsOn,
  invoiceNumber,
  email,
}: {
  token: string;
  status: string;
  internal: boolean;
  endsOn: string;
  invoiceNumber: string | null;
  email: string;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [newEnd, setNewEnd] = useState(addDays(endsOn, 1));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const active = ["confirmed", "prepping", "out", "requested"].includes(status);
  const canCancel = status === "requested" || status === "awaiting_payment";

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/equipment/rental/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: json.error ?? "That didn't go through. Try again." });
      return false;
    }
    setMsg({ ok: true, text: json.message ?? "Done." });
    router.refresh();
    return true;
  }

  const tab = (p: Exclude<Panel, null>, label: string) => (
    <button
      type="button"
      onClick={() => {
        setPanel(panel === p ? null : p);
        setMsg(null);
      }}
      className={cn(
        "h-[50px] flex-1 rounded-[8px] border text-[14px]",
        panel === p
          ? "border-[color:var(--hire-accent)] font-bold text-[color:var(--hire-accent)]"
          : "border-[color:var(--hire-line-strong)] text-[color:var(--hire-ink)]"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-6 flex flex-col gap-3">
      {active && (
        <div className="flex gap-2">
          {tab("extend", "Extend")}
          {tab("issue", "Report issue")}
          {!internal && tab("invoice", "Invoice")}
        </div>
      )}

      {panel === "extend" && (
        <div className="flex flex-col gap-2.5 rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] p-4">
          <label>
            <span className="hire-label mb-1.5 block">Keep it until</span>
            <input
              type="date"
              min={addDays(endsOn, 1)}
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
              className="min-h-[50px] w-full px-3.5 [color-scheme:dark]"
            />
          </label>
          <p className="text-[13px]">We check everything is free for the extra days and send it to the rental manager to confirm.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => call({ action: "extend", newEnd })}
            className="flex h-[50px] items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] font-bold text-[color:var(--hire-on-accent)]"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check and ask"}
          </button>
        </div>
      )}

      {panel === "issue" && (
        <div className="flex flex-col gap-2.5 rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] p-4">
          <label>
            <span className="hire-label mb-1.5 block">What&apos;s wrong?</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full px-3.5 py-3" />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await call({ action: "issue", text })) setText("");
            }}
            className="flex h-[50px] items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] font-bold text-[color:var(--hire-on-accent)]"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send to the rental manager"}
          </button>
        </div>
      )}

      {panel === "invoice" && (
        <div className="rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] p-4 text-[14px]">
          {invoiceNumber
            ? `Invoice ${invoiceNumber} was emailed to ${email} from our accounts system, with our bank details.`
            : status === "awaiting_payment"
              ? "Your invoice is sent once the payment lands."
              : `Your invoice is on its way to ${email}. If it hasn't arrived, reply to your confirmation email.`}
        </div>
      )}

      {msg && <p className={cn("text-[14px]", msg.ok ? "text-[color:var(--hire-ok)]" : "text-[color:var(--hire-accent)]")}>{msg.text}</p>}

      {canCancel && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(status === "requested" ? "Withdraw this request?" : "Cancel this checkout?")) call({ action: "cancel" });
          }}
          className="h-[50px] rounded-[8px] border border-[color:var(--hire-line-strong)] text-[14px] text-[color:var(--hire-ink)]"
        >
          {status === "requested" ? "Cancel request" : "Cancel checkout"}
        </button>
      )}
    </div>
  );
}
