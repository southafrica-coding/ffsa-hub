"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Kpi, KpiStrip, ModuleTabs, SectionBar, StatusPill } from "@/components/ffsa";
import {
  fmtUsd,
  formatUsDate,
  parseWorkbook,
  type Donor,
  type FlagCode,
  type RunOptions,
  type StatementBuild,
} from "@/lib/finance/donor-statements";
import type { DonorStatementSettings, RunRow } from "@/lib/finance/donor-statements-server";
import { SettingsCard } from "./settings-card";

type RunListItem = Pick<RunRow, "id" | "tax_year" | "source" | "source_file_name" | "status" | "imported_at" | "created_at">;
type Review = { run: RunRow; build: StatementBuild; options: RunOptions };

const FLAG_LABEL: Record<FlagCode, string> = {
  organisation: "Organisation",
  review_line: "Event / fundraiser",
  dts: "DTS gift",
  encoding_fixed: "Name repaired",
  incomplete_name: "Incomplete name",
  possible_duplicate: "Duplicate?",
  missing_email: "No email",
  invalid_email: "Bad email",
  credit_note: "Credit note",
  not_positive: "Zero total",
};

const api = "/api/finance/donor-statements";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export function DonorStatements() {
  const [tab, setTab] = useState<"review" | "settings">("review");
  const [settings, setSettings] = useState<DonorStatementSettings | null>(null);
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const { runs } = await call<{ runs: RunListItem[] }>(`${api}/runs`);
    setRuns(runs);
    return runs;
  }, []);

  useEffect(() => {
    Promise.all([call<{ settings: DonorStatementSettings }>(`${api}/settings`), loadRuns()])
      .then(([s, r]) => {
        setSettings(s.settings);
        if (r[0]) setRunId(r[0].id);
      })
      .catch((e) => setLoadError(e.message));
  }, [loadRuns]);

  if (loadError) {
    return <p className="px-5 py-8 text-sm text-destructive md:px-8">{loadError}</p>;
  }

  return (
    <>
      <ModuleTabs
        tabs={[
          { key: "review", label: "Statements" },
          { key: "settings", label: "Settings", mark: !!settings && (!settings.logo_path || !settings.signature_path) },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "review" | "settings")}
      />
      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
        {tab === "settings" && settings && <SettingsCard settings={settings} onSaved={setSettings} />}
        {tab === "review" && (
          <>
            <NewRun
              onCreated={async (id) => {
                await loadRuns();
                setRunId(id);
              }}
            />
            {runs && runs.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono-label">Imports</span>
                {runs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRunId(r.id)}
                    className="chip"
                    data-active={r.id === runId ? "true" : undefined}
                  >
                    {r.tax_year} · {r.source === "xero" ? "Xero" : r.source_file_name ?? "Upload"} ·{" "}
                    {new Date(r.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                  </button>
                ))}
              </div>
            )}
            {runId && (
              <RunReview
                key={runId}
                runId={runId}
                onArchived={async () => {
                  const r = await loadRuns();
                  setRunId(r[0]?.id ?? null);
                }}
              />
            )}
            {runs && runs.length === 0 && (
              <p className="text-sm text-[color:var(--text-tertiary)]">
                No imports yet. Pull a tax year from Xero, or upload a spreadsheet, to see the donor list.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ── Start an import ──────────────────────────────────────────

function NewRun({ onCreated }: { onCreated: (runId: string) => void }) {
  const now = new Date();
  // Statements go out in January for the year just ended.
  const [year, setYear] = useState(now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear());
  const [busy, setBusy] = useState<null | "xero" | "upload">(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function create(body: Record<string, unknown>) {
    const { runId, lineCount } = await call<{ runId: string; lineCount: number }>(`${api}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taxYear: year, ...body }),
    });
    toast.success(`Imported ${lineCount} invoice lines`);
    onCreated(runId);
  }

  async function pullXero() {
    setBusy("xero");
    try {
      await create({ source: "xero" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("upload");
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheets: Record<string, unknown[][]> = {};
      for (const name of wb.SheetNames) {
        sheets[name] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
      }
      const parsed = parseWorkbook(sheets);
      for (const w of parsed.warnings.slice(0, 5)) toast.warning(w);
      if (parsed.lines.length === 0) throw new Error("No donation rows found in that file.");
      await create({ source: "upload", fileName: file.name, lines: parsed.lines, contactEmails: parsed.contactEmails });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border border-ink">
      <SectionBar title="Import a tax year" meta="US gifts to FF SA USA, INC only" />
      <div className="flex flex-wrap items-end gap-4 p-5">
        <label className="block">
          <span className="mono-label mb-1 block">Tax year</span>
          <Input
            type="number"
            className="w-28"
            value={year}
            min={2020}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <Button onClick={pullXero} disabled={!!busy}>
          {busy === "xero" ? "Pulling from Xero…" : "Pull from US Xero"}
        </Button>
        <span className="pb-2.5 text-sm text-[color:var(--text-tertiary)]">or</span>
        <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={!!busy}>
          {busy === "upload" ? "Reading file…" : "Upload spreadsheet"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <p className="basis-full text-xs text-[color:var(--text-tertiary)]">
          Xero pulls every Approved or Paid invoice and credit note dated in the year, with contact emails. A spreadsheet can be
          Xero&rsquo;s Receivable Invoice Detail export, or a list with Donor Name / Email Address / Donation Amount / Donation Date
          columns; a Xero contacts export (ContactName, EmailAddress) in the same workbook fills in emails.
        </p>
      </div>
    </div>
  );
}

// ── The review ───────────────────────────────────────────────

type Filter = "all" | "flagged" | "email" | "excluded";

function RunReview({ runId, onArchived }: { runId: string; onArchived: () => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setReview(await call<Review>(`${api}/runs/${runId}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const editDonor = useCallback(
    async (donorKey: string, patch: Record<string, unknown>) => {
      try {
        await call(`${api}/runs/${runId}/donors`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ donorKey, ...patch }),
        });
        await load();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [runId, load]
  );

  async function setOption(patch: Partial<RunOptions>) {
    try {
      await call(`${api}/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: patch }),
      });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function archive() {
    if (!confirm("Hide this import? It's kept, just no longer listed.")) return;
    await call(`${api}/runs/${runId}`, { method: "DELETE" });
    onArchived();
  }

  const rows = useMemo(() => {
    if (!review) return [];
    const q = query.trim().toLowerCase();
    return review.build.donors.filter((d) => {
      const out = d.excluded || d.totalCents <= 0;
      if (filter === "excluded" ? !out : out) return false;
      if (filter === "flagged" && !d.flags.some((f) => f.code !== "missing_email" && f.code !== "invalid_email")) return false;
      if (filter === "email" && d.emailValid) return false;
      return !q || d.name.toLowerCase().includes(q) || (d.email ?? "").toLowerCase().includes(q);
    });
  }, [review, filter, query]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!review) return <p className="text-sm text-[color:var(--text-tertiary)]">Working out the donor list…</p>;

  const { build, options, run } = review;
  const t = build.totals;
  const allDonors = build.donors.filter((d) => !d.excluded && d.totalCents > 0);
  const counts: Record<Filter, number> = {
    all: allDonors.length,
    flagged: allDonors.filter((d) => d.flags.some((f) => f.code !== "missing_email" && f.code !== "invalid_email")).length,
    email: allDonors.filter((d) => !d.emailValid).length,
    excluded: build.donors.length - allDonors.length,
  };

  return (
    <div className="space-y-6">
      <div className="border border-ink">
        <SectionBar
          title={`${run.tax_year} donor list`}
          meta={`${run.source === "xero" ? "US Xero" : run.source_file_name ?? "Upload"} · imported ${new Date(run.imported_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}`}
        />
        <KpiStrip>
          <Kpi lead label="Grand total" value={fmtUsd(t.grandTotalCents)} size={26} foot="Reconcile against the books" />
          <Kpi label="Donors" value={String(t.donorCount)} foot={`${t.giftCount} gifts`} />
          <Kpi label="Need a look" value={String(t.flaggedCount)} foot="Flagged for review" valueColor={t.flaggedCount ? "var(--amber, #B26B00)" : undefined} />
          <Kpi label="No usable email" value={String(t.missingEmailCount)} foot="Post a paper statement" valueColor={t.missingEmailCount ? "var(--amber, #B26B00)" : undefined} />
        </KpiStrip>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 text-sm">
          <Choice
            label="Amount"
            value={options.amountBasis}
            options={[
              ["gross", "Gross gift (Unit Price × Qty)"],
              ["net", "Net after card fees"],
            ]}
            onChange={(v) => setOption({ amountBasis: v as RunOptions["amountBasis"] })}
          />
          <Choice
            label="Non-USD gifts"
            value={options.includeNonUsd ? "yes" : "no"}
            options={[
              ["no", "Leave out"],
              ["yes", "Include (USD value)"],
            ]}
            onChange={(v) => setOption({ includeNonUsd: v === "yes" })}
          />
          <Choice
            label="Credit notes"
            value={options.creditNotes}
            options={[
              ["exclude", "List only"],
              ["net", "Net off the named donor"],
            ]}
            onChange={(v) => setOption({ creditNotes: v as RunOptions["creditNotes"] })}
          />
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadCsv(run.tax_year, build.donors)}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Donor list CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={archive}>
              Hide import
            </Button>
          </div>
        </div>
      </div>

      <div className="border border-ink">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3">
          {(
            [
              ["all", "All donors"],
              ["flagged", "Needs a look"],
              ["email", "No email"],
              ["excluded", "Left out"],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" className="chip" data-active={filter === k ? "true" : undefined} onClick={() => setFilter(k)}>
              {label} · {counts[k]}
            </button>
          ))}
          <Input
            placeholder="Search name or email"
            className="ml-auto h-9 w-56"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Donor</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-[70px] text-right">Gifts</TableHead>
              <TableHead className="w-[120px] text-right">Total</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <DonorRow
                key={d.key}
                donor={d}
                open={open.has(d.key)}
                toggle={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(d.key)) n.delete(d.key);
                    else n.add(d.key);
                    return n;
                  })
                }
                others={build.donors.filter((o) => o.key !== d.key)}
                onEdit={(patch) => editDonor(d.key, patch)}
              />
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-[color:var(--text-tertiary)]">
                  Nobody here.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {filter === "all" && !query && (
            <TableFooter>
              <TableRow>
                <TableCell />
                <TableCell className="font-bold">Grand total · {t.donorCount} donors</TableCell>
                <TableCell />
                <TableCell className="text-right font-bold">{t.giftCount}</TableCell>
                <TableCell className="text-right font-bold">{fmtUsd(t.grandTotalCents)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <SetAside build={build} />
    </div>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="mono-label">{label}</span>
      <select
        className="h-9 border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function DonorRow({
  donor: d,
  open,
  toggle,
  others,
  onEdit,
}: {
  donor: Donor;
  open: boolean;
  toggle: () => void;
  others: Donor[];
  onEdit: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [email, setEmail] = useState(d.email ?? "");
  const [name, setName] = useState(d.name);
  const [mergeInto, setMergeInto] = useState("");
  useEffect(() => setEmail(d.email ?? ""), [d.email]);
  useEffect(() => setName(d.name), [d.name]);

  const out = d.excluded || d.totalCents <= 0;
  const flagCodes = [...new Set(d.flags.map((f) => f.code))];

  return (
    <Fragment>
      <TableRow className={out ? "opacity-60" : undefined}>
        <TableCell className="align-top">
          <button type="button" onClick={toggle} aria-label={open ? "Hide gifts" : "Show gifts"}>
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell className="align-top">
          <button type="button" onClick={toggle} className="text-left font-semibold hover:text-electric">
            {d.name}
          </button>
          {d.mergedFrom.length > 0 && (
            <div className="text-xs text-[color:var(--text-tertiary)]">+ {d.mergedFrom.join(", ")}</div>
          )}
        </TableCell>
        <TableCell className="align-top text-sm">
          {d.email ? (
            <span className={d.emailValid ? undefined : "text-destructive"}>{d.email}</span>
          ) : (
            <span className="text-[color:var(--text-tertiary)]">—</span>
          )}
          {d.emailSource && d.emailSource !== "source" && (
            <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#7C786C]">
              {d.emailSource === "edit" ? "edited" : d.emailSource}
            </span>
          )}
        </TableCell>
        <TableCell className="text-right align-top">{d.gifts.filter((g) => !g.isCreditNote).length}</TableCell>
        <TableCell className="text-right align-top font-semibold">{fmtUsd(d.totalCents)}</TableCell>
        <TableCell className="align-top">
          <div className="flex flex-wrap gap-1">
            {d.excluded && <StatusPill tone="quiet">Left out</StatusPill>}
            {flagCodes.map((c) => (
              <StatusPill key={c} tone={c === "missing_email" || c === "invalid_email" || c === "not_positive" ? "bad" : "warn"}>
                {FLAG_LABEL[c]}
              </StatusPill>
            ))}
          </div>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-bone hover:bg-bone">
          <TableCell />
          <TableCell colSpan={5} className="space-y-4 py-4">
            {d.flags.length > 0 && (
              <ul className="space-y-1 text-sm">
                {d.flags.map((f, i) => (
                  <li key={i}>
                    <span className="font-semibold">{FLAG_LABEL[f.code]}:</span> {f.detail}
                  </li>
                ))}
              </ul>
            )}
            <table className="w-full max-w-3xl text-sm">
              <thead>
                <tr className="text-left font-mono text-[9px] uppercase tracking-[0.12em] text-[#7C786C]">
                  <th className="py-1">Date</th>
                  <th>Invoice</th>
                  <th>Ministry</th>
                  <th>Description</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.gifts.map((g) => (
                  <tr key={g.invoiceNumber} className="border-t border-rule">
                    <td className="py-1">{formatUsDate(g.date)}</td>
                    <td>{g.invoiceNumber}</td>
                    <td>{g.ministry}</td>
                    <td className="text-[color:var(--text-tertiary)]">{g.descriptions.join(" · ")}</td>
                    <td className="text-right">
                      {fmtUsd(g.amountCents)}
                      {g.grossCents !== g.netCents && !g.isCreditNote && (
                        <span className="ml-1 text-xs text-[color:var(--text-tertiary)]">
                          (net {fmtUsd(g.netCents)})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mono-label mb-1 block">Email</span>
                <Input className="h-9 w-64" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              </label>
              <Button size="sm" variant="outline" disabled={email === (d.email ?? "")} onClick={() => onEdit({ email: email || null })}>
                Save email
              </Button>
              <label className="block">
                <span className="mono-label mb-1 block">Name on statement</span>
                <Input className="h-9 w-56" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <Button size="sm" variant="outline" disabled={name === d.name || !name.trim()} onClick={() => onEdit({ displayName: name })}>
                Save name
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mono-label mb-1 block">Same person as</span>
                <select
                  className="h-9 w-64 border border-input bg-background px-2 text-sm"
                  value={mergeInto}
                  onChange={(e) => setMergeInto(e.target.value)}
                >
                  <option value="">Choose a donor…</option>
                  {others.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="outline" disabled={!mergeInto} onClick={() => onEdit({ mergeIntoKey: mergeInto })}>
                Merge into them
              </Button>
              <Button size="sm" variant={d.excluded ? "default" : "outline"} onClick={() => onEdit({ excluded: !d.excluded })}>
                {d.excluded ? "Include again" : "Leave out of statements"}
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

function SetAside({ build }: { build: StatementBuild }) {
  const byReason = new Map<string, number>();
  for (const e of build.excludedLines) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  const merged = build.donors.filter((d) => d.mergedFrom.length > 0);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="border border-ink">
        <SectionBar title="Credit notes" meta={`${build.creditNotes.length} · ${fmtUsd(build.totals.creditNoteCents)}`} />
        <div className="p-4 text-sm">
          {build.creditNotes.length === 0 ? (
            <p className="text-[color:var(--text-tertiary)]">None in this year.</p>
          ) : (
            <>
              <p className="mb-3 text-[color:var(--text-tertiary)]">
                Never sent a statement. Whether the original gift should come off the named donor&rsquo;s statement is still
                Allyson&rsquo;s / the bookkeeper&rsquo;s call.
              </p>
              <ul className="space-y-1.5">
                {build.creditNotes.map((c) => (
                  <li key={c.invoiceNumber}>
                    <span className="font-semibold">{c.invoiceNumber}</span> · {formatUsDate(c.date)} · {c.contactName} ·{" "}
                    {fmtUsd(c.amountCents)} — &ldquo;{c.description}&rdquo;
                    {c.matchedDonorName ? (
                      <span className="text-grass-text"> → {c.matchedDonorName}</span>
                    ) : (
                      <span className="text-[color:var(--text-tertiary)]"> → no clear donor</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      <div className="border border-ink">
        <SectionBar title="Not counted" meta={`${build.excludedLines.length} lines · ${build.unpaidGifts.length} unpaid`} />
        <div className="space-y-3 p-4 text-sm">
          {byReason.size === 0 && build.unpaidGifts.length === 0 && (
            <p className="text-[color:var(--text-tertiary)]">Every imported line counted.</p>
          )}
          {[...byReason].map(([reason, n]) => (
            <div key={reason}>
              {reason} <span className="text-[color:var(--text-tertiary)]">· {n}</span>
            </div>
          ))}
          {build.unpaidGifts.length > 0 && (
            <div>
              <div className="font-semibold">Not fully paid yet (Approved in Xero)</div>
              <ul className="mt-1 space-y-0.5">
                {build.unpaidGifts.map((g) => (
                  <li key={g.invoiceNumber}>
                    {g.invoiceNumber} · {g.contactName} · {fmtUsd(g.grossCents)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {merged.length > 0 && (
            <div>
              <div className="font-semibold">Merged donors</div>
              {merged.map((d) => (
                <div key={d.key}>
                  {d.mergedFrom.join(", ")} → {d.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function downloadCsv(year: number, donors: Donor[]) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    ["Donor Name", "Email", "Gifts", "Total (USD)", "Included", "Flags"].join(","),
    ...donors.map((d) =>
      [
        esc(d.name),
        esc(d.email ?? ""),
        String(d.gifts.filter((g) => !g.isCreditNote).length),
        (d.totalCents / 100).toFixed(2),
        d.excluded || d.totalCents <= 0 ? "No" : "Yes",
        esc([...new Set(d.flags.map((f) => FLAG_LABEL[f.code]))].join("; ")),
      ].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `FF SA USA - ${year} donor list.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
