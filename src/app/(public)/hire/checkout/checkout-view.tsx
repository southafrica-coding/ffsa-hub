"use client";

// Checkout (frames 46d, 47a-5): one page, five steps. Finished steps fold
// into one line you can reopen. Outside hires: details, ID, collection,
// agreement, pay with PayFast (hire and deposit together). Ministry wings:
// details, ministry, collection, agreement, send the request.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { rands } from "@/lib/equipment/money";
import { dayLabel, rangeLabel } from "@/lib/equipment/dates";
import { periodLabel } from "@/lib/equipment/pricing";
import { agreementSections, agreementSummary } from "@/lib/equipment/agreement";
import { useCart } from "@/lib/equipment/use-cart";
import { useCheckedCart } from "../_components/use-checked-cart";

const TIMES = Array.from({ length: 19 }, (_, i) => {
  const m = 8 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

type Step = 0 | 1 | 2 | 3 | 4;

export function CheckoutView() {
  const router = useRouter();
  const [cart, setCart, loaded] = useCart();
  const { data, error: checkError, loading } = useCheckedCart(cart);
  const internal = cart?.internal === true && data?.internalAllowed === true;

  const [step, setStep] = useState<Step>(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [org, setOrg] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [ministryId, setMinistryId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fulfilment, setFulfilment] = useState<"collect" | "delivery">("collect");
  const [address, setAddress] = useState("");
  const [collectTime, setCollectTime] = useState("10:00");
  const [returnTime, setReturnTime] = useState("12:00");
  const [accepted, setAccepted] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from a signed-in account, once.
  useEffect(() => {
    if (data?.me) {
      setName((v) => v || data.me!.name);
      setEmail((v) => v || data.me!.email);
    }
  }, [data?.me]);

  const terms = data?.settings;
  const summary = useMemo(() => (terms ? agreementSummary(terms) : []), [terms]);
  const sections = useMemo(() => (terms ? agreementSections(terms) : []), [terms]);

  if (!loaded || (loading && !data)) {
    return (
      <main className="flex items-center gap-2 px-[18px] py-12 md:px-10">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your cart…
      </main>
    );
  }
  if (!cart || cart.lines.length === 0) {
    return (
      <main className="px-[18px] py-12 md:px-10">
        <h1 className="hire-display text-[52px]">Checkout</h1>
        <p className="mt-3">Your cart is empty.</p>
        <Link href="/hire" className="mt-4 inline-block underline underline-offset-4">
          Browse the store
        </Link>
      </main>
    );
  }
  if (checkError || !data || !data.settled) {
    return (
      <main className="px-[18px] py-12 md:px-10">
        <h1 className="hire-display text-[52px]">Checkout</h1>
        <p className="mt-3 max-w-[480px]">{checkError ?? "Something in your cart no longer fits your dates."}</p>
        <Link
          href="/hire/cart"
          className="mt-5 inline-flex h-12 items-center rounded-[8px] bg-[color:var(--hire-accent)] px-6 font-bold text-[color:var(--hire-on-accent)]"
        >
          Back to the cart
        </Link>
      </main>
    );
  }

  const q = data.quote;
  const range = rangeLabel(cart.from, cart.to);

  // ── Step checks: each returns an error in plain words, or null ──
  const checks: (() => string | null)[] = [
    () =>
      name.trim().length < 2
        ? "Add your full name."
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
          ? "That email address doesn't look right."
          : phone.replace(/\D/g, "").length < 9
            ? "Add a phone number we can reach you on."
            : null,
    () =>
      internal
        ? !ministryId
          ? "Pick the ministry this is for."
          : purpose.trim().length < 3
            ? "Say what it's for, e.g. “Youth night”."
            : null
        : idNumber.replace(/\s/g, "").length < 6
          ? "Add your ID or passport number."
          : null,
    () => (fulfilment === "delivery" && address.trim().length < 8 ? "Add the address we should deliver to." : null),
    () =>
      !accepted
        ? "Tick to accept the agreement."
        : signedName.trim().toLowerCase().replace(/\s+/g, " ") !== name.trim().toLowerCase().replace(/\s+/g, " ")
          ? "Type your name exactly as it is in your details."
          : null,
    () => null,
  ];

  function next(i: number) {
    const err = checks[i]();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setDone((d) => new Set(d).add(i));
    const firstOpen = ([0, 1, 2, 3, 4] as Step[]).find((s) => s > i && !done.has(s)) ?? 4;
    setStep(firstOpen);
  }

  async function submit() {
    for (let i = 0; i < 4; i++) {
      const err = checks[i]();
      if (err) {
        setStep(i as Step);
        setError(err);
        return;
      }
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/equipment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cart!.from,
        to: cart!.to,
        lines: cart!.lines,
        internal,
        customer: { name, email, phone, org },
        idNumber,
        ministryId,
        purpose,
        fulfilment,
        deliveryAddress: address,
        collectTime,
        returnTime,
        agreement: { accepted, signedName, version: data!.settings.agreement_version },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(json.error ?? "That didn't go through. Try again.");
      return;
    }
    if (json.redirectUrl) {
      window.location.href = json.redirectUrl; // PayFast; the cart is cleared once it's paid
      return;
    }
    setCart(null);
    router.push(json.orderUrl);
  }

  const titles = internal
    ? ["Your details", "Ministry", "Collection", "Rental agreement", "Send the request"]
    : ["Your details", "ID check", "Collection", "Rental agreement", "Pay"];
  const doneLine = [
    `${name} · ${email} · ${phone}`,
    internal ? `${data.ministries.find((m) => m.id === ministryId)?.name ?? ""} · ${purpose}` : "We check this ID when you collect",
    fulfilment === "delivery"
      ? `Delivery to ${address}`
      : `Collect ${dayLabel(cart.from)}, ${collectTime} · Return ${dayLabel(cart.to)} by ${returnTime}`,
    `Signed by ${signedName}`,
    "",
  ];

  const field = "min-h-[50px] w-full px-3.5";
  const label = "hire-label mb-1.5 block";
  const payLabel = internal ? "Send the request" : `Pay ${rands(q.totalCents + q.depositCents)} with PayFast`;

  return (
    <main className="pb-[160px] md:pb-12">
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_400px] md:gap-10 md:px-10 md:pt-8">
        <section className="px-[18px] pt-3 md:px-0 md:pt-0">
          <h1 className="hire-display text-[52px] md:text-[80px]">Checkout</h1>
          {internal && (
            <p className="mt-1 text-[14px] text-[color:var(--hire-accent)]">Ministry booking at the internal rate. It waits for the rental manager.</p>
          )}
          <ol className="mt-4 flex flex-col">
            {titles.map((title, i) => {
              const open = step === i;
              const finished = done.has(i) && !open;
              return (
                <li key={title} className="border-b border-[color:var(--hire-line)] py-3.5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[999px] text-[13px] font-bold",
                        finished
                          ? "bg-[color:var(--hire-ok)] text-[color:var(--hire-bg)]"
                          : open
                            ? "bg-[color:var(--hire-accent)] text-[color:var(--hire-on-accent)]"
                            : "border border-[color:var(--hire-line-strong)] text-[color:var(--hire-muted)]"
                      )}
                    >
                      {finished ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <h2 className={cn("text-[16px] font-bold normal-case tracking-normal", !open && !finished && "!text-[color:var(--hire-muted)]")} style={{ fontFamily: "inherit" }}>
                          {title}
                        </h2>
                        {finished && (
                          <button type="button" onClick={() => setStep(i as Step)} className="text-[13px] underline underline-offset-4">
                            Edit
                          </button>
                        )}
                      </div>
                      {finished && doneLine[i] && <p className="mt-0.5 truncate text-[13px]">{doneLine[i]}</p>}

                      {open && (
                        <div className="mt-3 flex flex-col gap-3">
                          {i === 0 && (
                            <>
                              <label>
                                <span className={label}>Full name</span>
                                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} />
                              </label>
                              <label>
                                <span className={label}>Email</span>
                                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={field} />
                              </label>
                              <label>
                                <span className={label}>Phone</span>
                                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" className={field} />
                              </label>
                              {!internal && (
                                <label>
                                  <span className={label}>Church or organisation (optional)</span>
                                  <input value={org} onChange={(e) => setOrg(e.target.value)} autoComplete="organization" className={field} />
                                </label>
                              )}
                            </>
                          )}

                          {i === 1 && !internal && (
                            <>
                              <label>
                                <span className={label}>SA ID or passport number</span>
                                <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} autoComplete="off" className={field} />
                              </label>
                              <p className="text-[13px] leading-relaxed">
                                Bring this ID when you collect. A staff member checks it against this number before anything is handed over.
                                We don&apos;t do an online ID check yet.
                              </p>
                            </>
                          )}
                          {i === 1 && internal && (
                            <>
                              <label>
                                <span className={label}>Ministry</span>
                                <select value={ministryId} onChange={(e) => setMinistryId(e.target.value)} className={field}>
                                  <option value="">Pick one</option>
                                  {data.ministries.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span className={label}>What&apos;s it for?</span>
                                <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Youth night" className={field} />
                              </label>
                            </>
                          )}

                          {i === 2 && (
                            <>
                              <div className="grid grid-cols-2 gap-2">
                                {(["collect", "delivery"] as const).map((f) => (
                                  <button
                                    key={f}
                                    type="button"
                                    onClick={() => setFulfilment(f)}
                                    className={cn(
                                      "min-h-[50px] rounded-[8px] border px-3 text-[15px]",
                                      fulfilment === f
                                        ? "border-[color:var(--hire-accent)] bg-[#2A2316] font-bold text-[color:var(--hire-accent)]"
                                        : "border-[color:var(--hire-line-strong)] text-[color:var(--hire-ink)]"
                                    )}
                                  >
                                    {f === "collect" ? "Collect from us" : "Delivered"}
                                  </button>
                                ))}
                              </div>
                              {fulfilment === "delivery" && (
                                <>
                                  <label>
                                    <span className={label}>Delivery address</span>
                                    <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="w-full px-3.5 py-3" />
                                  </label>
                                  <p className="text-[13px]">We quote delivery separately and confirm it with you by email.</p>
                                </>
                              )}
                              <div className="grid grid-cols-2 gap-2">
                                <label>
                                  <span className={label}>{fulfilment === "collect" ? "Collect" : "Deliver"} {dayLabel(cart.from)}</span>
                                  <select value={collectTime} onChange={(e) => setCollectTime(e.target.value)} className={field}>
                                    {TIMES.map((t) => (
                                      <option key={t}>{t}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  <span className={label}>Back {dayLabel(cart.to)} by</span>
                                  <select value={returnTime} onChange={(e) => setReturnTime(e.target.value)} className={field}>
                                    {TIMES.map((t) => (
                                      <option key={t}>{t}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            </>
                          )}

                          {i === 3 && (
                            <>
                              <ul className="flex flex-col gap-1.5 text-[14px] leading-relaxed text-[color:var(--hire-ink)]">
                                {summary.map((s) => (
                                  <li key={s}>{s}</li>
                                ))}
                              </ul>
                              <button type="button" onClick={() => setShowFull((v) => !v)} className="self-start text-[14px] underline underline-offset-4">
                                {showFull ? "Hide the full agreement" : "Read the full agreement"}
                              </button>
                              {showFull && (
                                <div className="max-h-[320px] overflow-y-auto rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] p-4 text-[13px] leading-relaxed">
                                  {sections.map((s) => (
                                    <div key={s.heading} className="mb-3 last:mb-0">
                                      <div className="font-bold text-[color:var(--hire-ink)]">{s.heading}</div>
                                      <p>{s.body}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <label className="flex min-h-[48px] items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={accepted}
                                  onChange={(e) => setAccepted(e.target.checked)}
                                  className="h-6 w-6 shrink-0 accent-[#FFB801]"
                                />
                                <span className="text-[14px] text-[color:var(--hire-ink)]">I&apos;ve read the rental agreement and accept it for this order.</span>
                              </label>
                              <label>
                                <span className={label}>Type your full name to sign</span>
                                <input value={signedName} onChange={(e) => setSignedName(e.target.value)} placeholder={name} className={field} />
                              </label>
                            </>
                          )}

                          {i === 4 && (
                            <p className="text-[13px]">
                              {internal
                                ? "The gear is held for you until the rental manager approves or declines. You'll get an email either way."
                                : "PayFast takes card, Instant EFT and SnapScan. The deposit is held as its own amount and refunded after the return check."}
                            </p>
                          )}

                          {error && <p className="text-[14px] text-[color:var(--hire-accent)]">{error}</p>}

                          {i < 4 ? (
                            <button
                              type="button"
                              onClick={() => next(i)}
                              className="h-[50px] rounded-[8px] bg-[color:var(--hire-accent)] text-[15px] font-bold text-[color:var(--hire-on-accent)] md:w-[260px]"
                            >
                              {i === 3 ? (internal ? "Continue" : "Continue to payment") : "Continue"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={submit}
                              disabled={busy}
                              className="hidden h-[52px] items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] text-[16px] font-bold text-[color:var(--hire-on-accent)] md:flex md:w-[320px]"
                            >
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : payLabel}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Order summary */}
        <aside className="mt-5 px-[18px] md:mt-[96px] md:px-0">
          <div className="flex flex-col gap-2 rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] p-[18px] text-[14px]">
            <div className="hire-label">
              {range} · {internal ? "ministry rate" : periodLabel(q.period, q.days)}
            </div>
            {data.lines.map((l) => (
              <div key={l.productId} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {l.quantity} × {l.title}
                </span>
                <span className="shrink-0 text-[color:var(--hire-ink)]">{rands(l.lineTotalCents)}</span>
              </div>
            ))}
            {q.waiverCents > 0 && (
              <div className="flex justify-between">
                <span>Damage waiver, {data.settings.waiver_bps / 100}%</span>
                <span className="text-[color:var(--hire-ink)]">{rands(q.waiverCents)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>VAT, {data.settings.vat_bps / 100}%</span>
              <span className="text-[color:var(--hire-ink)]">{rands(q.vatCents)}</span>
            </div>
            <div className="flex justify-between border-t border-[color:var(--hire-line2)] pt-2 font-bold text-[color:var(--hire-ink)]">
              <span>Hire total</span>
              <span>{rands(q.totalCents)}</span>
            </div>
            {!internal && (
              <>
                <div className="flex justify-between">
                  <span>Refundable deposit</span>
                  <span className="text-[color:var(--hire-ink)]">{rands(q.depositCents)}</span>
                </div>
                <div className="flex items-baseline justify-between border-t border-[color:var(--hire-line2)] pt-2">
                  <span className="text-[color:var(--hire-ink)]">Paid today</span>
                  <span className="hire-display text-[30px]">{rands(q.totalCents + q.depositCents)}</span>
                </div>
                <p className="text-[12px] text-[color:var(--hire-muted)]">The invoice and receipt go to {email || "your email"}.</p>
              </>
            )}
            {internal && <p className="text-[12px] text-[color:var(--hire-muted)]">No deposit for ministry wings. Damage is charged to the wing.</p>}
          </div>
        </aside>
      </div>

      {/* Phone: the pay button in a bar at the bottom (47a-5). */}
      {step === 4 && (
        <div
          className="fixed inset-x-0 z-30 border-t border-[color:var(--hire-line)] bg-[color:var(--hire-surface)] px-[18px] py-3 md:hidden"
          style={{ bottom: "calc(58px + max(10px, env(safe-area-inset-bottom, 0px)))" }}
        >
          {!internal && (
            <div className="mb-2 flex justify-between text-[13px]">
              <span>
                Hire {rands(q.totalCents)} + deposit {rands(q.depositCents)}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex h-[52px] w-full items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] text-[16px] font-bold text-[color:var(--hire-on-accent)]"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : payLabel}
          </button>
        </div>
      )}
    </main>
  );
}
