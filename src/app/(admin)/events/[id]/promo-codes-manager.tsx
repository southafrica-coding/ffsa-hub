"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currencySymbol, formatMoney } from "@/lib/currencies";
import type { FormField } from "@/lib/forms/schema";
import {
  parseWaivedQuestions,
  toPromoTerms,
  waivedQuestionIdsForTier,
  type PromoKind,
  type WaivedQuestionRef,
} from "@/lib/ticketing/promo-codes";

type TicketTypeLite = {
  id: string;
  name: string;
  // Per-ticket questions a code can waive on this tier (migration 138).
  questions: FormField[];
  // Whether the tier collects a signable waiver (migration 163).
  hasWaiver: boolean;
};
type PromoCode = {
  id: string;
  code: string;
  kind: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  applies_to_ticket_type_id: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  // Steps the code waives (migration 269).
  waives_waiver?: boolean;
  waived_questions?: unknown;
};

function describeValue(p: PromoCode, currency: string): string {
  if (p.kind === "percent") return `${p.percent_off}% off`;
  if (p.kind === "fixed_amount")
    return `${formatMoney(p.amount_off_cents ?? 0, currency)} off`;
  if (p.kind === "comp") return "Free (100% off)";
  if (p.kind === "none") return "No discount";
  return "—";
}

function describeWaives(p: PromoCode): string | null {
  const questions = parseWaivedQuestions(p.waived_questions).length;
  const parts: string[] = [];
  if (p.waives_waiver) parts.push("waiver");
  if (questions > 0) parts.push(`${questions} question${questions === 1 ? "" : "s"}`);
  return parts.length > 0 ? `Skips ${parts.join(" + ")}` : null;
}

function toIsoOrNull(dtLocal: string): string | null {
  if (!dtLocal) return null;
  const d = new Date(dtLocal);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ISO → the value a <input type="datetime-local"> expects, in local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const refKey = (r: WaivedQuestionRef) => `${r.ticket_type_id}:${r.question_id}`;

type FormState = {
  code: string;
  kind: PromoKind;
  percentOff: string;
  amountOff: string; // major units of `currency`
  appliesTo: string;
  maxRedemptions: string;
  validFrom: string;
  validUntil: string;
  waivesWaiver: boolean;
  waivedQuestions: WaivedQuestionRef[];
};

const EMPTY_FORM: FormState = {
  code: "",
  kind: "percent",
  percentOff: "",
  amountOff: "",
  appliesTo: "",
  maxRedemptions: "",
  validFrom: "",
  validUntil: "",
  waivesWaiver: false,
  waivedQuestions: [],
};

function formFromCode(p: PromoCode): FormState {
  return {
    code: p.code,
    kind: toPromoTerms(p).kind,
    percentOff: p.percent_off != null ? String(p.percent_off) : "",
    amountOff: p.amount_off_cents != null ? (p.amount_off_cents / 100).toFixed(2) : "",
    appliesTo: p.applies_to_ticket_type_id ?? "",
    maxRedemptions: p.max_redemptions != null ? String(p.max_redemptions) : "",
    validFrom: toLocalInput(p.valid_from),
    validUntil: toLocalInput(p.valid_until),
    waivesWaiver: p.waives_waiver === true,
    waivedQuestions: parseWaivedQuestions(p.waived_questions),
  };
}

export function PromoCodesManager({
  eventId,
  promoCodes,
  ticketTypes,
  currency,
}: {
  eventId: string;
  promoCodes: PromoCode[];
  ticketTypes: TicketTypeLite[];
  // Fixed-amount discounts are in the event's selling currency.
  currency: string;
}) {
  const router = useRouter();
  // null = closed, "new" = adding, otherwise the id of the code being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function open(target: PromoCode | null) {
    setForm(target ? formFromCode(target) : EMPTY_FORM);
    setEditing(target ? target.id : "new");
    setErr(null);
  }

  function close() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErr(null);
  }

  // Tiers the code applies to — and so the only tiers it can waive on.
  const scopedTiers = form.appliesTo
    ? ticketTypes.filter((t) => t.id === form.appliesTo)
    : ticketTypes;

  function setScope(tierId: string) {
    setForm((f) => ({
      ...f,
      appliesTo: tierId,
      // Waived questions outside the new scope would be rejected on save.
      waivedQuestions: tierId
        ? f.waivedQuestions.filter((r) => r.ticket_type_id === tierId)
        : f.waivedQuestions,
    }));
  }

  function toggleQuestion(ref: WaivedQuestionRef) {
    setForm((f) => {
      const has = f.waivedQuestions.some((r) => refKey(r) === refKey(ref));
      return {
        ...f,
        waivedQuestions: has
          ? f.waivedQuestions.filter((r) => refKey(r) !== refKey(ref))
          : [...f.waivedQuestions, ref],
      };
    });
  }

  async function save() {
    if (!form.code.trim()) {
      setErr("Code is required.");
      return;
    }
    const payload: Record<string, unknown> = {
      code: form.code.trim(),
      kind: form.kind,
      percent_off: null,
      amount_off_cents: null,
      applies_to_ticket_type_id: form.appliesTo || null,
      max_redemptions: form.maxRedemptions
        ? Number.parseInt(form.maxRedemptions, 10)
        : null,
      valid_from: toIsoOrNull(form.validFrom),
      valid_until: toIsoOrNull(form.validUntil),
      waives_waiver: form.waivesWaiver,
      waived_questions: form.waivedQuestions,
    };
    if (form.kind === "percent") {
      const n = Number.parseInt(form.percentOff, 10);
      if (!(n > 0 && n <= 100)) {
        setErr("Percent off must be a whole number from 1 to 100.");
        return;
      }
      payload.percent_off = n;
    }
    if (form.kind === "fixed_amount") {
      const n = Number.parseFloat(form.amountOff);
      if (!(n > 0)) {
        setErr("Amount off must be greater than 0.");
        return;
      }
      payload.amount_off_cents = Math.round(n * 100);
    }
    if (form.kind === "none" && !form.waivesWaiver && form.waivedQuestions.length === 0) {
      setErr("A code with no discount has to skip the waiver or at least one question.");
      return;
    }

    setBusy(true);
    setErr(null);
    const isNew = editing === "new";
    const res = await fetch(
      isNew
        ? `/api/events/${eventId}/promo-codes`
        : `/api/events/${eventId}/promo-codes/${editing}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to save code");
      return;
    }
    close();
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this code?")) return;
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/promo-codes/${id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to delete");
      return;
    }
    router.refresh();
  }

  async function toggleActive(p: PromoCode) {
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/promo-codes/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to update");
      return;
    }
    router.refresh();
  }

  const tierLookup = new Map(ticketTypes.map((t) => [t.id, t.name]));
  const anyWaiver = scopedTiers.some((t) => t.hasWaiver);
  const questionTiers = scopedTiers.filter((t) => t.questions.length > 0);

  const formBody = (
    <div className="border-t pt-3 space-y-2">
      <p className="text-xs font-medium">
        {editing === "new" ? "New code" : `Edit ${form.code || "code"}`}
      </p>
      <input
        type="text"
        value={form.code}
        onChange={(e) => set("code", e.target.value)}
        placeholder="Code (e.g. EARLY2026, STAFF, SPONSOR)"
        className="w-full border px-2 py-1.5 text-sm font-mono"
        disabled={busy}
      />
      <div>
        <label className="block text-xs text-muted-foreground mb-1">
          Discount
        </label>
        <select
          value={form.kind}
          onChange={(e) => set("kind", e.target.value as PromoKind)}
          className="w-full border px-2 py-1.5 text-sm"
          disabled={busy}
        >
          <option value="percent">Percent off</option>
          <option value="fixed_amount">Fixed amount off</option>
          <option value="comp">Comp (100% off — free)</option>
          <option value="none">No discount (only skips steps)</option>
        </select>
      </div>
      {form.kind === "percent" && (
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            % off
          </label>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={form.percentOff}
            onChange={(e) => set("percentOff", e.target.value)}
            placeholder="e.g. 10"
            className="w-full border px-2 py-1.5 text-sm"
            disabled={busy}
          />
        </div>
      )}
      {form.kind === "fixed_amount" && (
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            {`Amount off the order (${currency} ${currencySymbol(currency)})`}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.amountOff}
            onChange={(e) => set("amountOff", e.target.value)}
            placeholder="e.g. 50.00"
            className="w-full border px-2 py-1.5 text-sm"
            disabled={busy}
          />
        </div>
      )}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">
          Restrict to one tier (optional)
        </label>
        <select
          value={form.appliesTo}
          onChange={(e) => setScope(e.target.value)}
          className="w-full border px-2 py-1.5 text-sm"
          disabled={busy}
        >
          <option value="">— any tier —</option>
          {ticketTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          The discount and any skipped steps apply only to tickets of{" "}
          {form.appliesTo ? "this tier" : "every tier"} in the order.
        </p>
      </div>

      <div className="border p-2 space-y-2">
        <p className="text-xs font-medium">Skip steps for tickets bought with this code</p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.waivesWaiver}
            onChange={(e) => set("waivesWaiver", e.target.checked)}
            disabled={busy}
            className="mt-0.5"
          />
          <span>
            Skip the signable waiver
            <span className="block text-xs text-muted-foreground">
              {anyWaiver
                ? `Tiers with a waiver: ${scopedTiers
                    .filter((t) => t.hasWaiver)
                    .map((t) => t.name)
                    .join(", ")}`
                : "No tier in scope has a waiver yet. This takes effect if one is added."}
            </span>
          </span>
        </label>
        {questionTiers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No tier in scope has per-ticket questions to skip.
          </p>
        ) : (
          questionTiers.map((t) => {
            // A skipped question takes its follow-up questions with it.
            const implied = new Set(
              waivedQuestionIdsForTier(
                t.questions,
                toPromoTerms({
                  code: form.code,
                  kind: form.kind,
                  applies_to_ticket_type_id: form.appliesTo || null,
                  waived_questions: form.waivedQuestions,
                }),
                t.id
              )
            );
            return (
              <div key={t.id} className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {t.name} — questions to skip
                </p>
                {t.questions.map((q) => {
                  const ref = { ticket_type_id: t.id, question_id: q.id };
                  const picked = form.waivedQuestions.some(
                    (r) => refKey(r) === refKey(ref)
                  );
                  const viaParent = !picked && implied.has(q.id);
                  return (
                    <label
                      key={q.id}
                      className={`flex items-start gap-2 text-sm ${q.parentFieldId ? "pl-5" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={picked || viaParent}
                        onChange={() => toggleQuestion(ref)}
                        disabled={busy || viaParent}
                        className="mt-0.5"
                      />
                      <span>
                        {q.label || "Untitled question"}
                        {q.required && (
                          <span className="text-xs text-muted-foreground"> · required</span>
                        )}
                        {viaParent && (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            · skipped with its parent question
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Max redemptions (optional)
          </label>
          <input
            type="number"
            min="1"
            value={form.maxRedemptions}
            onChange={(e) => set("maxRedemptions", e.target.value)}
            placeholder="Unlimited"
            className="w-full border px-2 py-1.5 text-sm"
            disabled={busy}
          />
        </div>
        <div />
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Valid from (optional)
          </label>
          <input
            type="datetime-local"
            value={form.validFrom}
            onChange={(e) => set("validFrom", e.target.value)}
            className="w-full border px-2 py-1.5 text-sm"
            disabled={busy}
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Valid until (optional)
          </label>
          <input
            type="datetime-local"
            value={form.validUntil}
            onChange={(e) => set("validUntil", e.target.value)}
            className="w-full border px-2 py-1.5 text-sm"
            disabled={busy}
          />
        </div>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-3 py-1 bg-ink text-white text-xs hover:bg-[#262622] disabled:bg-[color:var(--surface-4)]"
        >
          Save code
        </button>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="px-3 py-1 border text-xs hover:bg-[color:var(--surface-2)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Promo &amp; comp codes</CardTitle>
        {editing === null && (
          <button
            type="button"
            onClick={() => open(null)}
            className="text-xs text-ink hover:underline"
          >
            + Add code
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Discount codes for promotions and 100%-off comp codes for staff,
          sponsors and scholarships. A code can also skip the waiver and
          chosen per-ticket questions for the tickets it applies to.
        </p>

        {promoCodes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No codes yet.</p>
        ) : (
          <ul className="space-y-2">
            {promoCodes.map((p) => {
              const waives = describeWaives(p);
              return (
                <li
                  key={p.id}
                  className="flex items-start justify-between gap-3 border p-3"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-mono font-medium">{p.code}</p>
                      {!p.is_active && (
                        <span className="text-xs px-1.5 py-0.5 border border-amber-border text-amber">
                          inactive
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {describeValue(p, currency)}
                      {waives ? ` · ${waives}` : ""}
                      {p.applies_to_ticket_type_id
                        ? ` · ${tierLookup.get(p.applies_to_ticket_type_id) ?? "specific tier"}`
                        : " · any tier"}
                      {p.max_redemptions
                        ? ` · ${p.redemption_count} / ${p.max_redemptions} used`
                        : ` · ${p.redemption_count} used`}
                    </p>
                    {(p.valid_from || p.valid_until) && (
                      <p className="text-xs text-muted-foreground">
                        Valid:
                        {p.valid_from
                          ? ` from ${new Date(p.valid_from).toLocaleString()}`
                          : ""}
                        {p.valid_until
                          ? ` until ${new Date(p.valid_until).toLocaleString()}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => open(p)}
                      disabled={busy || editing !== null}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(p)}
                      disabled={busy}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {p.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      disabled={busy || p.redemption_count > 0}
                      title={
                        p.redemption_count > 0
                          ? "Can't delete a code that's been redeemed. Deactivate instead."
                          : undefined
                      }
                      className="text-xs text-destructive hover:underline disabled:text-[color:var(--text-quiet)] disabled:no-underline"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {editing === null && err && <p className="text-xs text-destructive">{err}</p>}
        {editing !== null && formBody}
      </CardContent>
    </Card>
  );
}
