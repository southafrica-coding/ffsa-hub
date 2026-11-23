"use client";

// Count out / count back (stage O) for the counted lines on an order: how
// many glasses went out, how many came back, how many broke or went
// missing. Tagged gear keeps the scan flow (stage N). Rules:
// lib/equipment/inventory.ts (readCount) and equipment_count_line (381).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { BOX, PRIMARY } from "../../inventory-ui";

export type CountLine = {
  id: string;
  title: string;
  quantity: number;
  qtyOut: number | null;
  qtyBack: number | null;
  qtyDamaged: number | null;
  qtyMissing: number | null;
};

export function CountPanel({ orderId, status, lines }: { orderId: string; status: string; lines: CountLine[] }) {
  const canCountOut = ["confirmed", "prepping", "out"].includes(status);
  return (
    <section className="mt-2">
      <h2 className="hire-label bg-[color:var(--hire-surface)] px-[18px] py-2.5 font-bold md:px-9">Count out and back</h2>
      {!canCountOut && status === "requested" && (
        <p className="px-[18px] py-3 text-[13px] md:px-9">Approve the request first, then count it out at collection.</p>
      )}
      <ul>
        {lines.map((l) => (
          <CountRow key={l.id} orderId={orderId} line={l} canCountOut={canCountOut} />
        ))}
      </ul>
    </section>
  );
}

function CountRow({ orderId, line, canCountOut }: { orderId: string; line: CountLine; canCountOut: boolean }) {
  const router = useRouter();
  const stage: "out" | "back" | "done" = line.qtyBack !== null ? "done" : line.qtyOut !== null ? "back" : "out";
  const [count, setCount] = useState(String(stage === "out" ? line.quantity : (line.qtyOut ?? 0)));
  const [damaged, setDamaged] = useState("0");
  const [missing, setMissing] = useState("0");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/equipment/orders/${orderId}/count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineId: line.id,
        stage,
        count: Number(count),
        damaged: Number(damaged || 0),
        missing: Number(missing || 0),
        note,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't save the count.");
      return;
    }
    router.refresh();
  }

  const num = cn(BOX, "h-11 w-[72px] text-center tabular-nums");

  return (
    <li className="border-b border-[color:var(--hire-line)] px-[18px] py-3 md:px-9">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15px] text-[color:var(--hire-ink)]">
          {line.quantity} × {line.title}
        </span>
        <span className="text-[13px]">
          {stage === "out" && "Not counted out yet"}
          {stage === "back" && `${line.qtyOut} out`}
          {stage === "done" &&
            [
              `${line.qtyOut} out`,
              `${line.qtyBack} back`,
              line.qtyDamaged ? `${line.qtyDamaged} damaged` : null,
              line.qtyMissing ? `${line.qtyMissing} missing` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
        </span>
      </div>

      {stage === "out" && canCountOut && (
        <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
          <label>
            <span className="hire-label mb-1 block">Going out</span>
            <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className={num} />
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className={cn(BOX, "h-11 min-w-0 flex-1")}
          />
          <button type="button" onClick={save} disabled={busy} className={PRIMARY}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Count out"}
          </button>
        </div>
      )}

      {stage === "back" && (
        <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
          <label>
            <span className="hire-label mb-1 block">Back fine</span>
            <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className={num} />
          </label>
          <label>
            <span className="hire-label mb-1 block">Damaged</span>
            <input value={damaged} onChange={(e) => setDamaged(e.target.value)} inputMode="numeric" className={num} />
          </label>
          <label>
            <span className="hire-label mb-1 block">Missing</span>
            <input value={missing} onChange={(e) => setMissing(e.target.value)} inputMode="numeric" className={num} />
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={Number(damaged) + Number(missing) > 0 ? "What happened?" : "Note (optional)"}
            className={cn(BOX, "h-11 min-w-[160px] flex-1")}
          />
          <button type="button" onClick={save} disabled={busy} className={PRIMARY}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Count back"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[14px] text-[color:var(--hire-accent)]">{error}</p>}
    </li>
  );
}
