"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import {
  formatUsd,
  formatZar,
  monthLabel,
  parseAmountToCents,
  parseRateMicros,
  usdToZarCents,
} from "@/lib/missio/finance/report";
import type { FinanceEntryView, MissioFinanceResponse } from "@/lib/missio/finance/server";
import styles from "./finance.module.css";

export const MISSIO_FINANCE_ENTRIES_API = "/api/missio/finance/entries";

type Source = "cash" | "fundraiseup";

const SOURCE_WORD: Record<Source, string> = { cash: "Cash", fundraiseup: "FundraiseUp" };

/**
 * Cash and FundraiseUp, the two sources that aren't in the bank. One amount
 * per source per month; saving a month that already has one replaces it (the
 * database keeps the history). Until migration 394 is applied the form is
 * shown disabled with the reason.
 */
export function FinanceEntries({
  data,
  onSaved,
  post = postEntry,
  remove = deleteEntry,
}: {
  data: MissioFinanceResponse;
  onSaved: () => Promise<void> | void;
  post?: (body: Record<string, string>) => Promise<{ ok: boolean; status: number; message?: string; fieldErrors?: Record<string, string> }>;
  remove?: (source: Source, month: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const id = useId();
  const months = data.report.months;
  const off = data.entries.state !== "ok";
  const [source, setSource] = useState<Source>("cash");
  const [month, setMonth] = useState(months[months.length - 1]?.key ?? "");
  const [amount, setAmount] = useState("");
  const [usd, setUsd] = useState("");
  const [rate, setRate] = useState("");
  const [rateNote, setRateNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const existing = data.entries.rows.find((r) => r.source === source && r.month === month) ?? null;

  const preview = useMemo(() => {
    const u = parseAmountToCents(usd);
    const r = parseRateMicros(rate);
    return u !== null && r !== null ? usdToZarCents(u, r) : null;
  }, [usd, rate]);

  function edit(row: FinanceEntryView) {
    setSource(row.source);
    setMonth(row.month);
    setAmount(row.source === "cash" ? (row.zarCents / 100).toFixed(2) : "");
    setUsd(row.usdCents !== null ? (row.usdCents / 100).toFixed(2) : "");
    setRate(row.rate ?? "");
    setRateNote(row.rateNote ?? "");
    setErrors({});
    setMessage(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (off || busy) return;
    setBusy(true);
    setMessage(null);
    setErrors({});
    const body: Record<string, string> =
      source === "cash" ? { source, month, amount } : { source, month, usd, rate, rateNote };
    const res = await post(body).catch(() => ({ ok: false, status: 0, message: undefined, fieldErrors: undefined }));
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setMessage({ tone: "bad", text: res.message ?? "That didn’t save. Check the amounts and try again." });
      return;
    }
    setMessage({ tone: "ok", text: `${SOURCE_WORD[source]} for ${monthLabel(month)} saved.` });
    setAmount("");
    setUsd("");
    setRate("");
    setRateNote("");
    await onSaved();
  }

  async function removeRow(row: FinanceEntryView) {
    const key = `${row.source}|${row.month}`;
    if (confirming !== key) {
      setConfirming(key);
      return;
    }
    setConfirming(null);
    const res = await remove(row.source, row.month).catch(() => ({ ok: false, message: undefined }));
    setMessage(
      res.ok
        ? { tone: "ok", text: `${SOURCE_WORD[row.source]} for ${monthLabel(row.month)} removed.` }
        : { tone: "bad", text: res.message ?? "That didn’t remove. Try again." }
    );
    if (res.ok) await onSaved();
  }

  const fieldId = (name: string) => `${id}-${name}`;

  return (
    <section className={styles.panel} aria-labelledby={fieldId("title")} data-testid="finance-entries">
      <h2 id={fieldId("title")} className={styles.h2}>
        Cash and FundraiseUp
      </h2>
      <p className={styles.panelLede}>
        These aren’t in the bank, so a pastor enters them: one amount per month. Saving a month again replaces its
        amount, and every change is kept with who made it.
      </p>
      {off ? (
        <p className={styles.notice} role="status" data-testid="finance-entries-off">
          {data.entries.message ?? "Entries aren’t available right now."}
        </p>
      ) : null}

      <form className={styles.form} onSubmit={submit} noValidate>
        <fieldset className={styles.segment} disabled={off}>
          <legend className={styles.fieldLabel}>Source</legend>
          {(["cash", "fundraiseup"] as const).map((s) => (
            <label key={s} className={source === s ? styles.segmentOn : undefined}>
              <input type="radio" name="source" value={s} checked={source === s} onChange={() => setSource(s)} />
              {/* The shell colours every label (!important), so the words carry their own colour. */}
              <span>{SOURCE_WORD[s]}</span>
            </label>
          ))}
        </fieldset>

        <div className={styles.field}>
          <label htmlFor={fieldId("month")} className={styles.fieldLabel}>
            Month
          </label>
          <select id={fieldId("month")} value={month} onChange={(e) => setMonth(e.target.value)} disabled={off}>
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} {m.key.slice(0, 4)}
              </option>
            ))}
          </select>
          {errors.month ? <p className={styles.fieldError}>{errors.month}</p> : null}
        </div>

        {source === "cash" ? (
          <div className={styles.field}>
            <label htmlFor={fieldId("amount")} className={styles.fieldLabel}>
              Cash received (rand)
            </label>
            <input
              id={fieldId("amount")}
              inputMode="decimal"
              autoComplete="off"
              placeholder="1,900.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={off}
              aria-invalid={errors.amount ? true : undefined}
            />
            {errors.amount ? <p className={styles.fieldError}>{errors.amount}</p> : null}
          </div>
        ) : (
          <>
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label htmlFor={fieldId("usd")} className={styles.fieldLabel}>
                  Dollars after fees
                </label>
                <input
                  id={fieldId("usd")}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="1,250.40"
                  value={usd}
                  onChange={(e) => setUsd(e.target.value)}
                  disabled={off}
                  aria-invalid={errors.usd ? true : undefined}
                />
                {errors.usd ? <p className={styles.fieldError}>{errors.usd}</p> : null}
              </div>
              <div className={styles.field}>
                <label htmlFor={fieldId("rate")} className={styles.fieldLabel}>
                  Rand per dollar
                </label>
                <input
                  id={fieldId("rate")}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="18.25"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  disabled={off}
                  aria-invalid={errors.rate ? true : undefined}
                />
                {errors.rate ? <p className={styles.fieldError}>{errors.rate}</p> : null}
              </div>
            </div>
            <div className={styles.field}>
              <label htmlFor={fieldId("rateNote")} className={styles.fieldLabel}>
                Where the rate came from (optional)
              </label>
              <input
                id={fieldId("rateNote")}
                autoComplete="off"
                placeholder="Rate on the day each donation came in"
                value={rateNote}
                onChange={(e) => setRateNote(e.target.value)}
                disabled={off}
              />
            </div>
            <p className={styles.preview} aria-live="polite">
              {preview !== null ? `Counts as ${formatZar(preview)}` : "Enter dollars and a rate to see the rand amount."}
            </p>
          </>
        )}

        <div className={styles.formFoot}>
          <button type="submit" className={styles.primary} disabled={off || busy}>
            {busy ? "Saving…" : existing ? `Replace ${monthLabel(month)}` : "Save"}
          </button>
          {existing ? (
            <span className={styles.hint}>
              {monthLabel(month)} already has {formatZar(existing.zarCents)}.
            </span>
          ) : null}
        </div>
        {message ? (
          <p className={message.tone === "ok" ? styles.saved : styles.fieldError} role="status">
            {message.text}
          </p>
        ) : null}
      </form>

      {data.entries.rows.length > 0 ? (
        <details className={styles.entries}>
          <summary>Amounts entered ({data.entries.rows.length})</summary>
          <ul className={styles.entryList} aria-label="Amounts entered">
            {data.entries.rows.map((row) => {
              const key = `${row.source}|${row.month}`;
              return (
                <li key={key}>
                  <div>
                    <b>
                      {monthLabel(row.month)} · {SOURCE_WORD[row.source]}
                    </b>
                    <span>
                      {formatZar(row.zarCents)}
                      {row.usdCents !== null && row.rate ? ` (${formatUsd(row.usdCents)} at R${row.rate})` : ""}
                    </span>
                  </div>
                  <div className={styles.entryActions}>
                    <button type="button" className={styles.ghost} onClick={() => edit(row)}>
                      Edit
                    </button>
                    <button type="button" className={styles.ghost} onClick={() => void removeRow(row)}>
                      {confirming === key ? "Yes, remove" : "Remove"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

async function postEntry(body: Record<string, string>) {
  const res = await fetch(MISSIO_FINANCE_ENTRIES_API, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string; fieldErrors?: Record<string, string> };
  return {
    ok: res.ok,
    status: res.status,
    message: res.ok ? undefined : res.status === 503 || res.status === 403 ? json.error : undefined,
    fieldErrors: json.fieldErrors,
  };
}

async function deleteEntry(source: Source, month: string) {
  const params = new URLSearchParams({ source, month });
  const res = await fetch(`${MISSIO_FINANCE_ENTRIES_API}?${params}`, { method: "DELETE", credentials: "same-origin" });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, message: res.ok ? undefined : json.error };
}
