"use client";

// The pick list's interactive half: quantities, the running total, and the
// form that sends it. The server checks stock again when it's sent
// (/api/public/hire-request) and names any line that no longer fits.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { rands } from "@/lib/equipment/money";
import { FULFILMENT, HIRE_EMAIL } from "@/lib/equipment/helper";
import { Photo } from "../_components/store-ui";

export type PickItem = {
  id: string;
  slug: string;
  title: string;
  group: string;
  photo: string | null;
  /** False: on show only. Listed greyed out, never pickable. */
  forHire: boolean;
  free: number;
  /** Most one order may take: free, capped by the product's per-order limit. */
  max: number;
  priceCents: number;
  periodText: string;
  depositCents: number;
};

const field =
  "w-full rounded-[6px] border border-[color:var(--hire-line-strong)] bg-[color:var(--hire-surface2)] px-3.5 py-2.5 text-[16px] text-[color:var(--hire-ink)] placeholder:text-[color:var(--hire-dim)] [color-scheme:dark] focus:border-[color:var(--hire-accent)] focus:outline-none";

const picksParam = (picks: Record<string, number>) =>
  Object.entries(picks)
    .filter(([, n]) => n > 0)
    .map(([slug, n]) => `${slug}:${n}`)
    .join(",");

function Stepper({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex h-[44px] items-center rounded-[6px] border border-[color:var(--hire-line-strong)]">
      <button
        type="button"
        aria-label={`One fewer ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
        className="flex h-full w-11 items-center justify-center disabled:text-[color:var(--hire-dim)]"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-8 text-center text-[16px] font-bold text-[color:var(--hire-ink)]" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={`One more ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className="flex h-full w-11 items-center justify-center disabled:text-[color:var(--hire-dim)]"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export function PickList({
  items,
  today,
  from,
  to,
  datesChosen,
  rangeText,
  initialPicks,
}: {
  items: PickItem[];
  today: string;
  from: string;
  to: string;
  datesChosen: boolean;
  rangeText: string;
  initialPicks: Record<string, number>;
}) {
  const router = useRouter();
  const bySlug = useMemo(() => new Map(items.map((i) => [i.slug, i])), [items]);

  // Picks that arrived in the link but don't fit these dates are kept aside
  // and named, never silently dropped.
  const [picks, setPicks] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const [slug, n] of Object.entries(initialPicks)) {
      const item = bySlug.get(slug);
      if (item && item.max > 0) out[slug] = Math.min(n, item.max);
    }
    return out;
  });
  const notFitting = Object.entries(initialPicks).flatMap(([slug, n]) => {
    const item = bySlug.get(slug);
    if (!item) return [];
    if (!item.forHire) return [`${item.title} is on show only. It isn't for hire.`];
    if (item.max <= 0) return [`${item.title} isn't free on these dates.`];
    if (n > item.max) return [`Only ${item.max} of ${item.title} can be booked on these dates, so we've set it to ${item.max}.`];
    return [];
  });

  const [dates, setDates] = useState({ from, to });
  const [c, setC] = useState({ name: "", email: "", phone: "", org: "", fulfilment: "", venue: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [sent, setSent] = useState<string | null>(null);

  const chosen = items.filter((i) => (picks[i.slug] ?? 0) > 0);
  const hire = chosen.reduce((sum, i) => sum + i.priceCents * picks[i.slug], 0);
  const deposit = chosen.reduce((sum, i) => sum + i.depositCents * picks[i.slug], 0);
  const units = chosen.reduce((sum, i) => sum + picks[i.slug], 0);

  // Pickable gear, plus gear that's on show only (greyed, no stepper).
  // For-hire gear that's booked on these dates is left out and counted.
  const free = items.filter((i) => i.max > 0);
  const shown = items.filter((i) => i.max > 0 || !i.forHire);
  const bookedCount = items.filter((i) => i.forHire && i.max <= 0).length;
  const groups = Array.from(new Set(shown.map((i) => i.group)));
  const helperHref = `/hire/helper${datesChosen ? `?from=${from}&to=${to}` : ""}`;

  function changeDates(e: React.FormEvent) {
    e.preventDefault();
    const sp = new URLSearchParams({ from: dates.from, to: dates.to });
    const p = picksParam(picks);
    if (p) sp.set("pick", p);
    router.push(`/hire/request?${sp.toString()}`);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setProblems([]);
    if (chosen.length === 0) return setError("Choose at least one item.");
    if (c.name.trim().length < 2) return setError("Give us your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) return setError("Check your email address.");
    if (c.phone.trim().length < 6) return setError("Give us a phone number we can reach you on.");
    if (!c.fulfilment) return setError("Tell us whether you'll collect or need delivery.");
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        from,
        to,
        lines: chosen.map((i) => ({ productId: i.id, quantity: picks[i.slug] })),
        fulfilment: c.fulfilment,
        name: c.name.trim(),
        email: c.email.trim(),
        phone: c.phone.trim(),
      };
      for (const k of ["org", "venue", "notes"] as const) if (c[k].trim()) body[k] = c[k].trim();
      const res = await fetch("/api/public/hire-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? `We couldn't send your list. Try again, or email ${HIRE_EMAIL}.`);
        if (Array.isArray(json?.problems)) setProblems(json.problems.map((p: { text: string }) => p.text));
        return;
      }
      setSent(json.number as string);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("We couldn't send your list. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="max-w-[720px] rounded-[8px] border border-[color:var(--hire-accent)] bg-[color:var(--hire-surface)] p-5 md:p-8">
        <h2 className="hire-display text-[44px] md:text-[60px]">Thanks, we&apos;ve got your list</h2>
        <p className="mt-3 text-[16px] leading-relaxed">
          Your reference is <b className="text-[color:var(--hire-ink)]">{sent}</b>. The team will check it and email you a quote
          for {rangeText}. Nothing is booked until they confirm.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Link
        href={helperHref}
        className="flex flex-col gap-1 rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] px-4 py-3.5 text-[14px] hover:border-[color:var(--hire-line-strong)] md:flex-row md:items-center md:justify-between md:px-5"
      >
        <span>
          <b className="text-[color:var(--hire-ink)]">Not sure what you need?</b> Answer a few questions about your event
          instead, and our team will work it out.
        </span>
        <span className="shrink-0 font-bold text-[color:var(--hire-accent)]">Answer questions →</span>
      </Link>

      <form onSubmit={changeDates} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="hire-label">Collect</span>
          <input type="date" required min={today} value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="hire-label">Return</span>
          <input type="date" required min={dates.from || today} value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} className={field} />
        </label>
        <button
          type="submit"
          className="min-h-[46px] rounded-[6px] border border-[color:var(--hire-line-strong)] px-5 text-[15px] font-medium text-[color:var(--hire-ink)] hover:border-[color:var(--hire-body)]"
        >
          Change dates
        </button>
        <span className="text-[13px] text-[color:var(--hire-muted)] sm:pb-3">
          {datesChosen ? `Showing what's free ${rangeText}.` : `Showing the coming weekend, ${rangeText}. Pick your own dates.`}
        </span>
      </form>

      {notFitting.length > 0 && (
        <ul className="rounded-[8px] border border-[color:var(--hire-accent)] p-4 text-[14px] text-[color:var(--hire-ink)]">
          {notFitting.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_340px] md:gap-10">
        <div className="flex flex-col gap-8">
          {free.length === 0 && (
            <p className="text-[16px]">
              Nothing on the store is free on these dates. Try other dates, or{" "}
              <Link href={helperHref} className="font-bold text-[color:var(--hire-accent)]">
                tell us about your event
              </Link>{" "}
              and we&apos;ll see what we can do.
            </p>
          )}
          {groups.map((g) => (
            <section key={g}>
              <h2 className="hire-display mb-2 text-[30px] md:text-[40px]">{g}</h2>
              <ul className="border-t border-[color:var(--hire-line)]">
                {shown
                  .filter((i) => i.group === g)
                  .sort((a, b) => Number(b.forHire) - Number(a.forHire))
                  .map((i) => {
                    const n = picks[i.slug] ?? 0;
                    return (
                      <li
                        key={i.id}
                        aria-disabled={!i.forHire || undefined}
                        className={cn(
                          "grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 border-b border-[color:var(--hire-line)] py-3 sm:grid-cols-[64px_minmax(0,1fr)_auto]",
                          n > 0 && "bg-[color:var(--hire-surface)]",
                          !i.forHire && "opacity-45"
                        )}
                      >
                        <Photo src={i.photo} alt={i.title} className="h-16 w-16 rounded-[6px]" />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <Link
                            href={`/hire/p/${i.slug}?from=${from}&to=${to}`}
                            className="text-[15px] font-medium text-[color:var(--hire-ink)] underline-offset-4 hover:underline"
                          >
                            {i.title}
                          </Link>
                          <span className="text-[13px]">
                            {rands(i.priceCents)} {i.periodText} ·{" "}
                            {i.forHire ? (
                              <>
                                <span className="text-[color:var(--hire-ok)]">{i.free} free</span>
                                {i.max < i.free && (
                                  <span className="text-[color:var(--hire-muted)]"> · up to {i.max} per booking</span>
                                )}
                              </>
                            ) : (
                              <span className="text-[color:var(--hire-muted)]">On show only</span>
                            )}
                          </span>
                        </div>
                        <div className="col-start-2 sm:col-start-3">
                          {i.forHire ? (
                            <Stepper
                              label={i.title}
                              value={n}
                              max={i.max}
                              onChange={(v) => setPicks((p) => ({ ...p, [i.slug]: Math.max(0, Math.min(v, i.max)) }))}
                            />
                          ) : (
                            <span className="inline-flex h-[44px] items-center rounded-[6px] border border-dashed border-[color:var(--hire-line-strong)] px-3 text-[13px] font-medium text-[color:var(--hire-muted)]">
                              Not for hire
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
          {bookedCount > 0 && (
            <p className="text-[13px] text-[color:var(--hire-muted)]">
              {bookedCount} {bookedCount === 1 ? "item is" : "items are"} booked on these dates and not shown.
            </p>
          )}
        </div>

        <form
          onSubmit={send}
          noValidate
          className="mt-8 flex flex-col gap-4 self-start rounded-[8px] border border-[color:var(--hire-line-strong)] bg-[color:var(--hire-surface)] p-[18px] md:sticky md:top-24 md:mt-0"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-medium text-[color:var(--hire-ink)]">Your list</span>
            <span className="text-[13px] text-[color:var(--hire-muted)]">{rangeText}</span>
          </div>
          {chosen.length === 0 ? (
            <p className="text-[14px] text-[color:var(--hire-muted)]">Nothing picked yet. Use + next to an item.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[14px]">
              {chosen.map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {picks[i.slug]}× {i.title}
                  </span>
                  <span className="shrink-0 text-[color:var(--hire-ink)]">{rands(i.priceCents * picks[i.slug])}</span>
                </li>
              ))}
            </ul>
          )}
          {units > 0 && (
            <div className="flex flex-col gap-1 border-t border-[color:var(--hire-line2)] pt-3 text-[13px]">
              <div className="flex justify-between">
                <span>Hire, excl. 15% VAT</span>
                <span className="font-bold text-[color:var(--hire-ink)]">{rands(hire)}</span>
              </div>
              {deposit > 0 && (
                <div className="flex justify-between">
                  <span>Refundable deposit</span>
                  <span className="text-[color:var(--hire-ink)]">{rands(deposit)}</span>
                </div>
              )}
              <span className="text-[12px] text-[color:var(--hire-muted)]">The team confirms the final quote.</span>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-[color:var(--hire-line2)] pt-4">
            <input autoComplete="name" placeholder="Your name" aria-label="Your name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} maxLength={120} className={field} />
            <input type="email" autoComplete="email" placeholder="Email" aria-label="Email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} maxLength={200} className={field} />
            <input type="tel" autoComplete="tel" placeholder="Phone" aria-label="Phone" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} maxLength={40} className={field} />
            <input autoComplete="organization" placeholder="Church or organisation (optional)" aria-label="Church or organisation" value={c.org} onChange={(e) => setC({ ...c, org: e.target.value })} maxLength={120} className={field} />
            <select aria-label="Collect or delivery" value={c.fulfilment} onChange={(e) => setC({ ...c, fulfilment: e.target.value })} className={field}>
              <option value="">Collect or delivery?</option>
              {FULFILMENT.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {c.fulfilment === "delivery" && (
              <input placeholder="Delivery address" aria-label="Delivery address" value={c.venue} onChange={(e) => setC({ ...c, venue: e.target.value })} maxLength={200} className={field} />
            )}
            <textarea rows={2} placeholder="Anything else? (optional)" aria-label="Anything else" value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} maxLength={1500} className={field} />
          </div>

          {error && (
            <div role="alert" className="text-[14px] text-[color:var(--hire-accent)]">
              <p>{error}</p>
              {problems.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[6px] bg-[color:var(--hire-accent)] px-6 text-[15px] font-bold text-[color:var(--hire-on-accent)] disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send my list
          </button>
        </form>
      </div>
    </div>
  );
}
