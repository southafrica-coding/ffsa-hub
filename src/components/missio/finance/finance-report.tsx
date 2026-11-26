import {
  SOURCE_KEYS,
  SOURCE_LABEL,
  SOURCE_SHORT,
  formatLongDate,
  formatUsd,
  formatZar,
  formatZarCompact,
  formatZarWhole,
  monthLabel,
  type IncomeReport,
  type MonthRow,
  type SourceKey,
} from "@/lib/missio/finance/report";
import type { MissioFinanceResponse } from "@/lib/missio/finance/server";
import styles from "./finance.module.css";

/**
 * Board for the Missio income report (from the 19 Nov 2026 PDF): masthead,
 * total, four sources, monthly bars, month-by-source table, two averages and
 * the notes. Display only; MissioFinance fetches and passes the response in.
 */

/** Order bars stack from the bottom, and the order of every list. */
export const SOURCE_CLASS: Record<SourceKey, string> = {
  bank: styles.srcBank,
  snapscan: styles.srcSnap,
  fundraiseup: styles.srcFru,
  cash: styles.srcCash,
};

export function FinanceReport({ data }: { data: MissioFinanceResponse }) {
  const { report } = data;
  const partial = report.months.find((m) => m.partial) ?? null;
  return (
    <>
      <Masthead report={report} partial={partial} />
      {data.bank.state !== "ok" && data.bank.message ? (
        <p className={styles.notice} role="status" data-testid="finance-bank-notice">
          <b>Bank and SnapScan figures are missing.</b> {data.bank.message}
        </p>
      ) : null}
      {report.hasData ? (
        <>
          <TotalBlock report={report} />
          <SourceCards data={data} />
          <MonthlyChart report={report} partial={partial} />
          <MonthTable report={report} />
          <Averages report={report} partial={partial} />
        </>
      ) : (
        <EmptyReport data={data} />
      )}
    </>
  );
}

export function FinanceNotes({ data }: { data: MissioFinanceResponse }) {
  const { report } = data;
  const usd = data.entries.rows.filter((r) => r.source === "fundraiseup").reduce((s, r) => s + (r.usdCents ?? 0), 0);
  const cash = data.entries.rows.filter((r) => r.source === "cash");
  const partial = report.months.find((m) => m.partial);
  return (
    <section className={styles.notes} aria-labelledby="finance-notes">
      <h2 id="finance-notes" className={styles.h2}>
        How these figures were put together
      </h2>
      <ul>
        <li>
          <b>EFT &amp; other bank:</b> all money received into the Missio bank account in Xero
          {data.bank.accountLabel ? `, ${data.bank.accountLabel}` : ""}, less SnapScan payouts. A receipt counts as
          SnapScan when its reference, contact or description says SnapScan, so this split is approximate.
        </li>
        <li>
          <b>SnapScan:</b> counted on the day the payout reached the bank. A payout SnapScan has made but the bank
          hasn’t received yet isn’t in Xero, so it isn’t counted until it lands.
        </li>
        <li>
          <b>FundraiseUp:</b> donations arrive in US dollars
          {usd > 0 ? ` (${formatUsd(usd)} after fees in this period)` : ""} in a separate account. A pastor enters each
          month’s dollars after fees and the rand rate used, so the rand amounts are estimates. A direct FundraiseUp
          connection is planned.
        </li>
        <li>
          <b>Cash:</b> amounts entered by Missio
          {cash.length > 0
            ? ` (${cash.map((c) => `${monthLabel(c.month)} ${formatZarWhole(c.zarCents)}`).join(", ")})`
            : ""}
          . Cash is not in the bank figures.
        </li>
        <li>
          Bank income only covers money already booked in Xero. Bank lines nobody has reconciled yet aren’t included,
          so the true total may be slightly higher. Transfers between FFSA’s own accounts, refunds and money paid out
          are neither counted nor subtracted.
        </li>
        <li>
          Figures run to {formatLongDate(report.today)}, South African time
          {partial ? `; ${partial.label} is a partial month` : ""}. Averages divide by every month in the period,
          including months where a source had nothing.
        </li>
      </ul>
    </section>
  );
}

// ── Masthead ────────────────────────────────────────────────

function rangeTitle(report: IncomeReport): string {
  const first = report.months[0];
  const last = report.months[report.months.length - 1];
  if (!first || !last) return "";
  const y1 = first.key.slice(0, 4);
  const y2 = last.key.slice(0, 4);
  if (first.key === last.key) return `${first.label} ${y1}`;
  return y1 === y2 ? `${first.label} to ${last.label} ${y2}` : `${first.label} ${y1} to ${last.label} ${y2}`;
}

function Masthead({ report, partial }: { report: IncomeReport; partial: MonthRow | null }) {
  return (
    <header className={styles.masthead}>
      <div>
        <p className={styles.eyebrow}>Income report</p>
        <h1 className={styles.title}>{rangeTitle(report)}</h1>
      </div>
      <div className={styles.prepared}>
        <p>Prepared {formatLongDate(report.today)}</p>
        {partial ? (
          <p>
            {partial.label} is a partial month, to {Number(partial.through.slice(8, 10))} {partial.short}
          </p>
        ) : null}
      </div>
    </header>
  );
}

// ── Total and sources ───────────────────────────────────────

function TotalBlock({ report }: { report: IncomeReport }) {
  const n = report.months.length;
  return (
    <section className={styles.total} aria-labelledby="finance-total">
      <h2 id="finance-total" className={styles.label}>
        Total income received
      </h2>
      <p className={styles.totalFigure} data-testid="finance-total">
        {formatZar(report.total)}
      </p>
      {report.averages.all.cents !== null ? (
        <p className={styles.totalSub}>
          Across {n} {n === 1 ? "month" : "months"}, an average of{" "}
          <b className={styles.accent}>{formatZar(report.averages.all.cents)} per month</b>
        </p>
      ) : null}
    </section>
  );
}

function SourceCards({ data }: { data: MissioFinanceResponse }) {
  const bankMissing = data.bank.state !== "ok";
  const entriesMissing = data.entries.state !== "ok";
  return (
    <section aria-label="Income by source">
      <ul className={styles.cards}>
        {data.report.sources.map((s) => {
          const unavailable = s.key === "bank" || s.key === "snapscan" ? bankMissing : entriesMissing;
          return (
            <li key={s.key} className={`${styles.card} ${SOURCE_CLASS[s.key]}`} data-testid={`finance-card-${s.key}`}>
              <p className={styles.cardLabel}>
                <span className={styles.swatch} aria-hidden="true" />
                {SOURCE_LABEL[s.key]}
              </p>
              {s.total !== null ? (
                <>
                  <p className={styles.cardFigure}>{formatZar(s.total)}</p>
                  <p className={styles.cardShare}>{s.share !== null ? `${s.share.toFixed(1)}% of total` : "—"}</p>
                  <p className={styles.cardAvg}>Avg {formatZar(s.perMonth ?? 0)} / month</p>
                </>
              ) : (
                <>
                  <p className={`${styles.cardFigure} ${styles.cardEmpty}`}>—</p>
                  <p className={styles.cardAvg}>
                    {unavailable ? "Not available yet" : s.key === "bank" || s.key === "snapscan" ? "Nothing received" : "Nothing entered yet"}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Chart ───────────────────────────────────────────────────

/** A round top for the axis: 83,629 → 90,000 with three steps of 30,000. */
export function chartScale(maxCents: number): { top: number; ticks: number[] } {
  if (maxCents <= 0) return { top: 100_000, ticks: [0, 50_000, 100_000] };
  const rough = maxCents / 3;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 3, 5, 10].map((m) => m * pow).find((s) => s * 3 >= maxCents) ?? 10 * pow;
  return { top: step * 3, ticks: [0, step, step * 2, step * 3] };
}

function barLabel(m: MonthRow): string {
  const parts = SOURCE_KEYS.map((k) => `${SOURCE_SHORT[k]} ${m.bySource[k] === null ? "none" : formatZar(m.bySource[k]!)}`);
  return `${m.label}${m.partial ? " (partial month)" : ""}: total ${formatZar(m.total)}. ${parts.join(", ")}.`;
}

function MonthlyChart({ report, partial }: { report: IncomeReport; partial: MonthRow | null }) {
  const { top, ticks } = chartScale(Math.max(...report.months.map((m) => m.total), 0));
  const compact = report.months.length > 6;
  return (
    <section className={styles.panel} aria-labelledby="finance-chart">
      <div className={styles.chartHead}>
        <h2 id="finance-chart" className={styles.h2}>
          Income by month
        </h2>
        <Legend />
      </div>
      <div className={styles.chart}>
        <div className={styles.axis} aria-hidden="true">
          {ticks
            .slice()
            .reverse()
            .map((t) => (
              <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
                {formatZarCompact(t)}
              </span>
            ))}
        </div>
        <div className={styles.plot}>
          <div className={styles.gridLayer} aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} className={styles.grid} style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
          </div>
          <ol className={styles.bars}>
            {report.months.map((m) => (
              <li key={m.key} className={styles.col}>
                <div className={styles.stack} role="img" aria-label={barLabel(m)} data-testid={`finance-bar-${m.key}`}>
                  <div className={styles.stackInner} style={{ height: `${(m.total / top) * 100}%` }}>
                    {m.total > 0 ? (
                      <span className={styles.barTotal}>{compact ? formatZarCompact(m.total) : formatZarWhole(m.total)}</span>
                    ) : null}
                    {SOURCE_KEYS.map((k) => {
                      const v = m.bySource[k];
                      if (!v || v <= 0 || m.total <= 0) return null;
                      return <span key={k} className={`${styles.seg} ${SOURCE_CLASS[k]}`} style={{ flexGrow: v }} />;
                    })}
                  </div>
                </div>
                <span className={styles.month} aria-hidden="true">
                  <span className={styles.monthLong}>{m.label}</span>
                  <span className={styles.monthShort}>{m.short}</span>
                  {m.partial ? " *" : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {partial ? (
        <p className={styles.foot}>
          * Partial month, to {Number(partial.through.slice(8, 10))} {partial.label}.
        </p>
      ) : null}
    </section>
  );
}

export function Legend() {
  return (
    <ul className={styles.legend} aria-label="Sources">
      {SOURCE_KEYS.map((k) => (
        <li key={k} className={SOURCE_CLASS[k]}>
          <span className={styles.swatch} aria-hidden="true" />
          {SOURCE_SHORT[k]}
        </li>
      ))}
    </ul>
  );
}

// ── Month by source ─────────────────────────────────────────

function cell(v: number | null): string {
  return v === null ? "—" : formatZar(v);
}

function MonthTable({ report }: { report: IncomeReport }) {
  const totals = report.sources;
  return (
    <section className={styles.tableSection} aria-labelledby="finance-table">
      <h2 id="finance-table" className={styles.h2}>
        Income by month and source
      </h2>

      {/* Wide screens: the report's table. */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {SOURCE_KEYS.map((k) => (
                <th key={k} scope="col">
                  {SOURCE_SHORT[k]}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {report.months.map((m) => (
              <tr key={m.key}>
                <th scope="row">
                  {m.label}
                  {m.partial ? " *" : ""}
                </th>
                {SOURCE_KEYS.map((k) => (
                  <td key={k} className={m.bySource[k] === null ? styles.none : undefined}>
                    {cell(m.bySource[k])}
                  </td>
                ))}
                <td className={styles.strong}>{formatZar(m.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <th scope="row">Total</th>
              {totals.map((s) => (
                <td key={s.key}>{cell(s.total)}</td>
              ))}
              <td>{formatZar(report.total)}</td>
            </tr>
            <tr className={styles.avgRow}>
              <th scope="row">Average per month</th>
              {totals.map((s) => (
                <td key={s.key}>{cell(s.perMonth)}</td>
              ))}
              <td>{report.averages.all.cents === null ? "—" : formatZar(report.averages.all.cents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phones: one card per month, no sideways scrolling. */}
      <ol className={styles.monthCards}>
        {report.months.map((m) => (
          <li key={m.key} className={styles.monthCard}>
            <div className={styles.monthCardHead}>
              <h3>
                {m.label}
                {m.partial ? <span className={styles.partialTag}>Partial, to {Number(m.through.slice(8, 10))} {m.short}</span> : null}
              </h3>
              <b>{formatZar(m.total)}</b>
            </div>
            <SourceList values={SOURCE_KEYS.map((k) => m.bySource[k])} />
          </li>
        ))}
        <li className={`${styles.monthCard} ${styles.monthCardTotal}`}>
          <div className={styles.monthCardHead}>
            <h3>Total</h3>
            <b>{formatZar(report.total)}</b>
          </div>
          <SourceList values={totals.map((s) => s.total)} />
        </li>
        <li className={`${styles.monthCard} ${styles.monthCardAvg}`}>
          <div className={styles.monthCardHead}>
            <h3>Average per month</h3>
            <b>{report.averages.all.cents === null ? "—" : formatZar(report.averages.all.cents)}</b>
          </div>
          <SourceList values={totals.map((s) => s.perMonth)} />
        </li>
      </ol>
    </section>
  );
}

function SourceList({ values }: { values: Array<number | null> }) {
  return (
    <dl className={styles.sourceList}>
      {SOURCE_KEYS.map((k, i) => (
        <div key={k} className={SOURCE_CLASS[k]}>
          <dt>
            <span className={styles.swatch} aria-hidden="true" />
            {SOURCE_SHORT[k]}
          </dt>
          <dd className={values[i] === null ? styles.none : undefined}>{cell(values[i])}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Averages ────────────────────────────────────────────────

function Averages({ report, partial }: { report: IncomeReport; partial: MonthRow | null }) {
  const { all, fullMonths, normalMonth } = report.averages;
  // "Includes July and a partial November", as the report words it.
  const included = [
    normalMonth ? report.months[0]?.label : null,
    partial ? `a partial ${partial.label}` : null,
  ].filter(Boolean);
  const allNote = included.length ? `Includes ${included.join(" and ")}` : "Every month in the period";
  return (
    <section aria-labelledby="finance-averages">
      <h2 id="finance-averages" className={styles.h2}>
        Average income per month
      </h2>
      <div className={styles.averages}>
        <div className={`${styles.avgCard} ${styles.avgAll}`} data-testid="finance-avg-all">
          <p className={styles.label}>
            All {report.months.length} months{all.span ? ` (${all.span})` : ""}
          </p>
          <p className={styles.avgFigure}>{all.cents === null ? "—" : formatZar(all.cents)}</p>
          <p className={styles.avgSub}>{allNote}</p>
        </div>
        <div className={`${styles.avgCard} ${styles.avgFull}`} data-testid="finance-avg-full">
          <p className={styles.label}>Full months only{fullMonths.span ? ` (${fullMonths.span})` : ""}</p>
          <p className={styles.avgFigure}>{fullMonths.cents === null ? "—" : formatZar(fullMonths.cents)}</p>
          <p className={styles.avgSub}>
            {fullMonths.cents === null
              ? "No month in this period is over yet."
              : partial
                ? `Complete calendar months; ${partial.label} is left out because it isn’t over.`
                : "Complete calendar months."}
          </p>
          {normalMonth && normalMonth.cents !== null ? (
            <p className={styles.avgAlt} data-testid="finance-avg-normal">
              Leaving out {monthLabel(report.months[0].key)} as well, as the 19 November report did:{" "}
              <b>{formatZar(normalMonth.cents)}</b> ({normalMonth.span}), “a fairer picture of a normal month”.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ── Empty ───────────────────────────────────────────────────

function EmptyReport({ data }: { data: MissioFinanceResponse }) {
  return (
    <section className={styles.empty} data-testid="finance-empty">
      <div className={styles.emptySlots} aria-hidden="true">
        {SOURCE_KEYS.map((k) => (
          <span key={k} className={SOURCE_CLASS[k]} />
        ))}
      </div>
      <h2 className={styles.emptyTitle}>No income to show yet</h2>
      <p>
        {data.bank.state === "ok"
          ? "Xero has no money received into the Missio bank account in this period."
          : "Bank and SnapScan income come from Xero, and Xero can’t be read yet."}{" "}
        {data.entries.state === "ok"
          ? "No cash or FundraiseUp amounts have been entered."
          : "Cash and FundraiseUp entries aren’t switched on yet."}
      </p>
    </section>
  );
}
