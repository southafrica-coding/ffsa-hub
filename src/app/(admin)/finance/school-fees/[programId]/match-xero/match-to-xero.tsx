"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Search, Link2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill, type Tone } from "@/components/ffsa";
import { formatZAR } from "@/lib/finance/billing";
import type { ProgramCheck, StudentCheck, SetupResult, LinkResult } from "@/services/xero-match";

// Three steps, each safe to repeat: set up billing for everyone, check each
// student's Xero invoices against their charges (read-only), then link the
// matches finance ticks. Linked charges are never invoiced by the Hub again;
// whatever is left unmatched is what the Hub invoices from here on.

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

const key = (chargeId: string, invoiceId: string) => `${chargeId}|${invoiceId}`;

function summary(s: StudentCheck): { label: string; tone: Tone } {
  if (!s.hasPlan) {
    return { label: s.match?.unmatched.length ? "Set up billing, then match" : "No billing set up", tone: "warn" };
  }
  const m = s.match;
  if (m?.suggestedTier) return { label: `Invoiced at tier ${m.suggestedTier}`, tone: "bad" };
  if (m && m.links.length) return { label: `${m.links.length} to link`, tone: "warn" };
  if (m && m.unmatched.length) return { label: "Check by hand", tone: "bad" };
  if (!s.xeroContact) return { label: "Not in Xero", tone: "quiet" };
  if (m && m.alreadyLinked) return { label: "Linked", tone: "good" };
  return { label: "Nothing invoiced yet", tone: "quiet" };
}

async function post<T>(body: Record<string, unknown>): Promise<{ ok: boolean; json: T & { error?: string } }> {
  const res = await fetch("/api/finance/school-fees/match-xero", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, json: await res.json().catch(() => ({ error: "Bad response" })) };
}

export function MatchToXero({
  programId,
  canEdit,
  hubBilled,
  emailsOn,
}: {
  programId: string;
  canEdit: boolean;
  hubBilled: boolean;
  emailsOn: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<ProgramCheck | null>(null);
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());

  async function runCheck() {
    setBusy("check");
    try {
      const { ok, json } = await post<ProgramCheck>({ programId, action: "check" });
      if (!ok) return void toast.error(json.error || "Couldn't read Xero");
      setCheck(json);
      if (json.errors.length) toast.error(json.errors.join(" · "));
      // Tick every match whose amount agrees; differing amounts wait for a person.
      setChosen(
        new Set(
          json.students.flatMap((s) =>
            (s.match?.links ?? []).filter((l) => !l.amountDiffers).map((l) => key(l.chargeId, l.invoiceId))
          )
        )
      );
      setOpen(new Set(json.students.filter((s) => (s.match?.links.length ?? 0) + (s.match?.unmatched.length ?? 0) > 0).map((s) => s.enrollmentId)));
    } finally {
      setBusy(null);
    }
  }

  async function runSetup() {
    setBusy("setup");
    try {
      const { ok, json } = await post<SetupResult>({ programId, action: "setup" });
      if (!ok) return void toast.error(json.error || "Couldn't set up billing");
      setSetup(json);
      toast.success(
        json.created.length
          ? `Billing set up for ${json.created.length} student${json.created.length === 1 ? "" : "s"}`
          : "Everyone already has billing set up"
      );
      if (json.failed.length) toast.error(`${json.failed.length} couldn't be set up — see below`);
    } finally {
      setBusy(null);
    }
    await runCheck();
  }

  async function runLink() {
    const pairs = [...chosen].map((k) => {
      const [chargeId, invoiceId] = k.split("|");
      return { chargeId, invoiceId };
    });
    setBusy("link");
    try {
      const { ok, json } = await post<LinkResult>({ programId, action: "link", pairs });
      if (!ok) return void toast.error(json.error || "Couldn't link");
      toast.success(
        `Linked ${json.linked} charge${json.linked === 1 ? "" : "s"}${json.skipped ? ` · ${json.skipped} skipped (changed since the check)` : ""}`
      );
      if (json.errors.length) toast.error(json.errors.join(" · "));
    } finally {
      setBusy(null);
    }
    await runCheck();
  }

  async function switchTier(s: StudentCheck, tier: string) {
    setBusy(`tier-${s.enrollmentId}`);
    try {
      const { ok, json } = await post<{ success: boolean }>({ programId, action: "tier", enrollmentId: s.enrollmentId, tier });
      if (!ok) return void toast.error(json.error || "Couldn't change the tier");
      toast.success(`${s.name} is now billed at tier ${tier}`);
    } finally {
      setBusy(null);
    }
    await runCheck();
  }

  const toggle = (k: string) =>
    setChosen((c) => {
      const n = new Set(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const toggleOpen = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const students = check?.students ?? [];
  const noPlan = students.filter((s) => !s.hasPlan).length;

  return (
    <>
      <section className="border border-ink bg-white">
        <div className="border-b border-rule px-4 py-3">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">How this works</h2>
        </div>
        <ol className="list-decimal space-y-1 px-8 py-3 text-[13px]">
          <li>
            <strong>Set up billing</strong> for every student who has none, from this school&apos;s payment schedules.
            Nothing is invoiced — anything already due is held.
          </li>
          <li>
            <strong>Check Xero</strong> — read-only. Each student&apos;s Xero invoices (found by their email) are matched to
            their charges by item code.
          </li>
          <li>
            <strong>Link</strong> the matches you tick. Linked charges show their Xero invoice and payments and are never
            invoiced again; the Hub invoices only what&apos;s left.
          </li>
        </ol>
        {!hubBilled && (
          <p className="border-t border-rule bg-bone px-4 py-2 text-xs">
            This school is billed outside the Hub. Switch it to Hub billing in its{" "}
            <Link className="underline" href={`/finance/school-fees/${programId}/billing`}>
              fee settings
            </Link>{" "}
            before setting up billing.
          </p>
        )}
        {emailsOn && (
          <p className="border-t border-rule bg-bone px-4 py-2 text-xs text-[color:var(--text-secondary)]">
            Invoice emails are <strong>on</strong> for this school. Matching sends nothing, but you may want them held
            until you&apos;ve linked everyone, so nothing goes out before you&apos;re done.
          </p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2 border-t border-rule px-4 py-3">
            <Button size="sm" variant="outline" disabled={busy !== null || !hubBilled} onClick={runSetup}>
              {busy === "setup" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Users className="mr-1 h-3.5 w-3.5" />}
              1. Set up billing for everyone
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={runCheck}>
              {busy === "check" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
              2. Check Xero
            </Button>
            <Button size="sm" disabled={busy !== null || chosen.size === 0} onClick={runLink}>
              {busy === "link" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1 h-3.5 w-3.5" />}
              3. Link {chosen.size} selected
            </Button>
          </div>
        )}
      </section>

      {setup && (setup.failed.length > 0 || setup.warnings.length > 0) && (
        <section className="border border-rule-strong bg-white px-4 py-3 text-xs">
          {setup.failed.map((f) => (
            <p key={f.enrollmentId} className="text-destructive">
              {f.name}: {f.error}
            </p>
          ))}
          {setup.warnings.map((w) => (
            <p key={w} className="text-[color:var(--text-secondary)]">
              {w}
            </p>
          ))}
        </section>
      )}

      {check && (
        <section className="border border-ink bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
            <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">Students</h2>
            <span className="text-xs text-[color:var(--text-secondary)]">
              {students.length} students
              {noPlan > 0 && ` · ${noPlan} without billing`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-rule font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                  <th className="px-4 py-2">Student</th>
                  <th className="px-2 py-2">Xero</th>
                  <th className="px-2 py-2">Tier</th>
                  <th className="px-2 py-2">Not invoiced</th>
                  <th className="px-4 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const st = summary(s);
                  const m = s.match;
                  const expandable = !!m && (m.links.length > 0 || m.unmatched.length > 0);
                  return (
                    <Fragment key={s.enrollmentId}>
                      <tr
                        className={`border-b border-rule ${expandable ? "cursor-pointer hover:bg-bone" : ""}`}
                        onClick={() => expandable && toggleOpen(s.enrollmentId)}
                      >
                        <td className="px-4 py-2">
                          <span className="font-semibold">{s.name}</span>
                          <span className="block text-[11px] text-[color:var(--text-secondary)]">{s.email ?? "no email"}</span>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {s.region === "us" ? "US" : "SA"}
                          {!s.xeroContact && <span className="block text-[10px] text-[color:var(--text-tertiary)]">no contact</span>}
                        </td>
                        <td className="px-2 py-2">{s.tier ?? "—"}</td>
                        <td className="px-2 py-2">{s.hasPlan ? s.openCharges : "—"}</td>
                        <td className="px-4 py-2">
                          <StatusPill tone={st.tone}>{st.label}</StatusPill>
                        </td>
                      </tr>
                      {expandable && open.has(s.enrollmentId) && (
                        <tr className="border-b border-rule bg-bone/60">
                          <td colSpan={5} className="px-4 py-3">
                            {m!.links.length > 0 && (
                              <table className="mb-2 w-full text-[12px]">
                                <thead>
                                  <tr className="font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                                    <th className="w-6" />
                                    <th className="py-1 text-left">Hub charge</th>
                                    <th className="py-1 text-left">Xero invoice</th>
                                    <th className="py-1 text-left">Item code</th>
                                    <th className="py-1 text-right">Hub</th>
                                    <th className="py-1 text-right">Xero</th>
                                    <th className="py-1 text-right">Paid on invoice</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {m!.links.map((l) => {
                                    const k = key(l.chargeId, l.invoiceId);
                                    return (
                                      <tr key={k}>
                                        <td>
                                          {canEdit && (
                                            <input
                                              type="checkbox"
                                              aria-label={`Link ${l.chargeLabel} to ${l.invoiceNumber}`}
                                              checked={chosen.has(k)}
                                              onChange={() => toggle(k)}
                                            />
                                          )}
                                        </td>
                                        <td className="py-1">
                                          {l.chargeLabel} <span className="text-[color:var(--text-secondary)]">· due {fmtDate(l.chargeDueDate)}</span>
                                        </td>
                                        <td className="py-1 font-mono">
                                          {l.invoiceNumber ?? "—"}{" "}
                                          <span className="font-sans text-[color:var(--text-secondary)]">
                                            · {l.invoiceStatus.toLowerCase()} · due {fmtDate(l.invoiceDueDate)}
                                          </span>
                                        </td>
                                        <td className="py-1 font-mono">{l.itemCode}</td>
                                        <td className="py-1 text-right font-mono">{formatZAR(l.chargeAmount)}</td>
                                        <td className={`py-1 text-right font-mono ${l.amountDiffers ? "font-bold text-destructive" : ""}`}>
                                          {formatZAR(l.lineAmount)}
                                        </td>
                                        <td className="py-1 text-right font-mono">
                                          {l.invoiceAmountPaid > 0 ? formatZAR(l.invoiceAmountPaid) : "—"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                            {m!.links.some((l) => l.amountDiffers) && (
                              <p className="mb-2 text-[11px] text-destructive">
                                Red amounts differ from the Hub charge — not ticked. Linking keeps the Hub amount; the paid
                                figure comes from Xero.
                              </p>
                            )}
                            {m!.unmatched.length > 0 && (
                              <div className="space-y-1 text-[12px]">
                                {m!.unmatched.map((u, i) => (
                                  <p key={i}>
                                    <span className="font-mono">{u.invoiceNumber ?? "—"}</span> · {u.itemCode} · {formatZAR(u.amount)} —{" "}
                                    {!s.hasPlan
                                      ? "matches once billing is set up (step 1)."
                                      : u.reason === "tier_mismatch"
                                        ? `invoiced at tier ${u.invoicedTier}, but the Hub bills tier ${s.tier}.`
                                        : "no Hub charge left for this code. Check it by hand."}
                                  </p>
                                ))}
                                {m!.suggestedTier && canEdit && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-1"
                                    disabled={busy !== null}
                                    onClick={() => switchTier(s, m!.suggestedTier!)}
                                  >
                                    {busy === `tier-${s.enrollmentId}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                                    Bill {s.name.split(" ")[0]} at tier {m!.suggestedTier} instead
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
