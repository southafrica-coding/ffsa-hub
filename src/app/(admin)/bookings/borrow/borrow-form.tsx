"use client";

// The borrow form: dates, what you need, who it's for. Free counts come from
// the server for the chosen dates (changing a date reloads them); the API
// route checks everything again before placing the request.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { dayCount, rangeLabel } from "@/lib/equipment/dates";
import { rands } from "@/lib/equipment/money";

export type BorrowItem = {
  id: string;
  name: string;
  make: string;
  description: string | null;
  category: string;
  stock: number;
  free: number;
  max: number | null;
  internalDayCents: number;
  location: string | null;
  photo: string | null;
};

const INPUT = "h-11 w-full border border-rule-strong bg-white px-3 text-[16px] normal-case tracking-normal text-ink md:text-[14px]";

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mono-label mb-1.5 block">
      {children}
      {hint && <span className="ml-2 normal-case tracking-normal text-[color:var(--text-tertiary)]">{hint}</span>}
    </span>
  );
}

export function BorrowForm({
  from,
  to,
  today,
  items,
  ministries,
  schools,
  defaultPhone,
}: {
  from: string;
  to: string;
  today: string;
  items: BorrowItem[];
  ministries: { id: string; name: string }[];
  schools: { id: string; name: string }[];
  defaultPhone: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [forType, setForType] = useState<"school" | "ministry" | null>(null);
  const [forId, setForId] = useState("");
  const [v, setV] = useState({ purpose: "", phone: defaultPhone, collectTime: "", returnTime: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ number: string; orderUrl: string } | null>(null);

  const days = dayCount(from, to);
  const picked = items.filter((i) => (qty[i.id] ?? 0) > 0);
  const totalCents = picked.reduce((sum, i) => sum + i.internalDayCents * days * qty[i.id], 0);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const shown = items.filter(
      (i) => !q || [i.name, i.make, i.category, i.description].some((f) => f && f.toLowerCase().includes(q))
    );
    const map = new Map<string, BorrowItem[]>();
    for (const i of shown) map.set(i.category, [...(map.get(i.category) ?? []), i]);
    return [...map.entries()];
  }, [items, q]);

  function setDates(nextFrom: string, nextTo: string) {
    const t = nextTo < nextFrom ? nextFrom : nextTo;
    router.push(`/bookings/borrow?from=${nextFrom}&to=${t}`, { scroll: false });
  }

  function bump(item: BorrowItem, by: number) {
    const cap = Math.min(item.free, item.max ?? Infinity);
    setQty((x) => ({ ...x, [item.id]: Math.max(0, Math.min(cap, (x[item.id] ?? 0) + by)) }));
  }

  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/equipment/borrow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        lines: picked.map((i) => ({ productId: i.id, quantity: qty[i.id] })),
        forType,
        forId,
        ...v,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't send the request.");
      return;
    }
    setSent({ number: data.number, orderUrl: data.orderUrl });
  }

  if (sent) {
    return (
      <div className="px-5 py-8 md:px-8">
        <div className="max-w-xl border border-ink bg-white px-6 py-6">
          <div className="mono-label">Request {sent.number}</div>
          <h2 className="mt-2 text-[22px]">Sent to the inventory manager</h2>
          <p className="mt-2 text-[14px] text-[color:var(--text-secondary)]">
            The items are held for you until it&apos;s approved or declined. You&apos;ll get an email either way.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href={sent.orderUrl}
              className="inline-flex min-h-11 items-center border border-ink bg-ink px-4 text-[14px] font-bold text-white hover:text-white"
            >
              See your request
            </Link>
            <Link href="/bookings/borrow" className="inline-flex min-h-11 items-center border border-ink px-4 text-[14px]">
              Borrow something else
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const readyToSend = picked.length > 0 && forType && forId && v.purpose.trim();

  return (
    <div className="pb-[120px] md:pb-10">
      {/* ── When ── */}
      <section className="grid gap-3 border-b border-rule px-5 py-5 md:grid-cols-[200px_200px_minmax(0,1fr)] md:items-end md:px-8">
        <label className="block">
          <Label>Collect</Label>
          <input type="date" min={today} value={from} onChange={(e) => setDates(e.target.value, to)} className={INPUT} />
        </label>
        <label className="block">
          <Label>Bring back</Label>
          <input type="date" min={from} value={to} onChange={(e) => setDates(from, e.target.value)} className={INPUT} />
        </label>
        <p className="text-[13px] text-[color:var(--text-secondary)] md:pb-3">
          {rangeLabel(from, to)} · {days} {days === 1 ? "day" : "days"}. Counts below are what&apos;s free on these dates.
        </p>
      </section>

      {/* ── What ── */}
      <section className="border-b border-rule">
        <div className="flex items-center gap-3 px-5 py-3 md:px-8">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search glasses, tablecloths, lights…"
            className={cn(INPUT, "md:max-w-[360px]")}
          />
        </div>
        {items.length === 0 && (
          <p className="px-5 pb-6 text-[14px] text-[color:var(--text-secondary)] md:px-8">
            Nothing can be borrowed yet. The inventory manager chooses what goes on this list.
          </p>
        )}
        {groups.map(([category, list]) => (
          <div key={category}>
            <h3 className="mono-label border-y border-rule bg-bone px-5 py-2 md:px-8">{category}</h3>
            <ul>
              {list.map((i) => {
                const n = qty[i.id] ?? 0;
                const cap = Math.min(i.free, i.max ?? Infinity);
                return (
                  <li
                    key={i.id}
                    className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 border-b border-rule px-5 py-3 last:border-b-0 md:px-8"
                  >
                    {i.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.photo} alt="" className="h-12 w-12 object-cover" />
                    ) : (
                      <span className="h-12 w-12 bg-bone" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-ink">{i.name}</span>
                      <span className="block truncate text-[12px] text-[color:var(--text-secondary)]">
                        {[i.make, i.description].filter(Boolean).join(" · ") || "No description yet"}
                      </span>
                      <span className={cn("block text-[12px]", i.free === 0 ? "font-semibold text-ink" : "text-[color:var(--text-tertiary)]")}>
                        {i.free === 0 ? "None free on these dates" : `${i.free} of ${i.stock} free`}
                        {i.location ? ` · ${i.location}` : ""}
                        {i.internalDayCents > 0 ? ` · ${rands(i.internalDayCents)}/day` : ""}
                      </span>
                    </span>
                    <span className="flex items-center">
                      <button
                        type="button"
                        aria-label={`One fewer ${i.name}`}
                        onClick={() => bump(i, -1)}
                        disabled={n === 0}
                        className="flex h-11 w-11 items-center justify-center border border-rule-strong disabled:opacity-30"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-10 text-center font-display text-[20px] font-black tabular-nums">{n}</span>
                      <button
                        type="button"
                        aria-label={`One more ${i.name}`}
                        onClick={() => bump(i, 1)}
                        disabled={n >= cap}
                        className="flex h-11 w-11 items-center justify-center border border-rule-strong disabled:opacity-30"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {/* ── Who and why ── */}
      <section className="grid max-w-3xl gap-4 px-5 py-5 md:grid-cols-2 md:px-8">
        <div className="md:col-span-2">
          <Label>Who is it for?</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["school", "ministry"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={forType === t}
                onClick={() => {
                  setForType(t);
                  setForId("");
                }}
                className={cn(
                  "min-h-11 border px-3 text-[14px] font-semibold",
                  forType === t ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink"
                )}
              >
                {t === "school" ? "A school" : "A ministry"}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-[color:var(--text-tertiary)]">
            Borrowing for yourself? Hire it on the <Link href="/hire" className="underline">equipment store</Link> instead.
          </p>
        </div>
        {forType && (
          <label className="block md:col-span-2">
            <Label>{forType === "school" ? "Which school" : "Which ministry"}</Label>
            <select value={forId} onChange={(e) => setForId(e.target.value)} className={INPUT}>
              <option value="">Pick one</option>
              {(forType === "school" ? schools : ministries).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block md:col-span-2">
          <Label>What it&apos;s for</Label>
          <input
            value={v.purpose}
            onChange={(e) => setV({ ...v, purpose: e.target.value })}
            placeholder="DTS outreach dinner"
            className={INPUT}
          />
        </label>
        <label className="block">
          <Label hint="optional">Collect at</Label>
          <input type="time" value={v.collectTime} onChange={(e) => setV({ ...v, collectTime: e.target.value })} className={INPUT} />
        </label>
        <label className="block">
          <Label hint="optional">Back by</Label>
          <input type="time" value={v.returnTime} onChange={(e) => setV({ ...v, returnTime: e.target.value })} className={INPUT} />
        </label>
        <label className="block">
          <Label hint="optional">Phone</Label>
          <input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" className={INPUT} />
        </label>
        <label className="block md:col-span-2">
          <Label hint="optional">Anything else</Label>
          <textarea
            value={v.notes}
            onChange={(e) => setV({ ...v, notes: e.target.value })}
            rows={3}
            className={cn(INPUT, "h-auto py-2")}
          />
        </label>
      </section>

      {/* ── Send: a bar on phones, inline on desktop ── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink bg-white px-5 py-3 md:static md:border-t-0 md:px-8 md:py-0">
        {error && <p className="mb-2 text-[14px] font-semibold text-ink">{error}</p>}
        <div className="flex items-center justify-between gap-4 md:justify-start">
          <span className="text-[13px] text-[color:var(--text-secondary)]">
            {picked.length === 0
              ? "Pick at least one item"
              : `${picked.reduce((s, i) => s + qty[i.id], 0)} items · ${totalCents === 0 ? "no charge" : rands(totalCents)}`}
          </span>
          <button
            type="button"
            onClick={send}
            disabled={!readyToSend || busy}
            className="flex min-h-11 min-w-[140px] items-center justify-center border border-ink bg-ink px-4 text-[14px] font-bold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}
