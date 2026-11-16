// Donor statements — the import rules (docs: Sample Person 50's "Donor Statements – Hub
// Setup Instructions", Oct 2026).
//
// Input is a list of invoice LINES, either pulled from the US Xero org or
// read from a Xero "Receivable Invoice Detail" export. The rules turn lines
// into gifts and gifts into donors:
//
//   • One row is an invoice line, not a gift. Lines sharing an Invoice
//     Number are one gift; gifts are grouped by donor name (Xero contact
//     names are unique, so the name is the donor).
//   • The gift amount is Unit Price × Quantity (gross). Invoice Total repeats
//     on every line and is net of card fees — never summed; it is only the
//     "net" basis when finance chooses it.
//   • Only Paid invoices count. Card fees and pass-through lines are dropped.
//   • Credit notes (CN-…) never produce a statement. They are listed, and
//     matched to the donor they name where possible.
//   • Non-USD lines are left out unless the run says otherwise.
//
// Everything that needs a human decision is flagged, not silently decided.
// Pure functions, no I/O — the routes do the reading and writing.

export type SourceLine = {
  invoiceNumber: string;
  invoiceDate: string | null; // YYYY-MM-DD
  contactName: string;
  contactId?: string | null;
  email?: string | null;
  itemCode?: string | null;
  description?: string | null;
  accountCode?: string | null;
  quantity: number;
  unitPriceUsd: number;
  invoiceTotalUsd?: number | null;
  currency: string;
  status: string; // PAID | AUTHORISED | …
};

export type RunOptions = {
  amountBasis: "gross" | "net";
  includeNonUsd: boolean;
  creditNotes: "exclude" | "net";
};

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  amountBasis: "gross",
  includeNonUsd: false,
  creditNotes: "exclude",
};

export type ImportRules = {
  accountCodes: string[];
  excludedItemCodes: string[];
  excludedLinePhrases: string[];
  reviewLinePhrases: string[];
  organisationPhrases: string[];
};

export const DEFAULT_IMPORT_RULES: ImportRules = {
  accountCodes: ["1010", "1012", "1013", "1080"],
  excludedItemCodes: ["STRIPE"],
  excludedLinePhrases: ["Stripe Card Processing Fee", "10% to FFSA"],
  reviewLinePhrases: ["Send Night", "Fundraiser", "Ticket", "Event"],
  organisationPhrases: [
    "Charitable", "School", "Church", "Foundation", "Fund", "Trust", "Ministries",
    "Ministry", "Inc", "LLC", "Ltd", "Tech", "Company", "Corp",
  ],
};

export type DonorEdit = {
  donorKey: string;
  email?: string | null;
  displayName?: string | null;
  excluded?: boolean;
  mergeIntoKey?: string | null;
  note?: string | null;
};

export type Ministry = "Fire & Fragrance South Africa" | "Missio Church";

export type Gift = {
  invoiceNumber: string;
  date: string | null;
  amountCents: number; // on the run's basis
  grossCents: number;
  netCents: number;
  ministry: Ministry;
  descriptions: string[];
  isCreditNote: boolean;
};

export type FlagCode =
  | "organisation"
  | "review_line"
  | "dts"
  | "encoding_fixed"
  | "incomplete_name"
  | "possible_duplicate"
  | "missing_email"
  | "invalid_email"
  | "credit_note"
  | "not_positive";

export type Flag = { code: FlagCode; detail: string };

export type EmailSource = "edit" | "source" | "xero" | "hub" | null;

export type Donor = {
  key: string;
  name: string;
  sourceNames: string[];
  email: string | null;
  emailSource: EmailSource;
  emailValid: boolean;
  gifts: Gift[];
  totalCents: number;
  flags: Flag[];
  excluded: boolean;
  mergedFrom: string[];
  note: string | null;
};

export type ExcludedLine = { line: SourceLine; reason: string };

export type CreditNote = {
  invoiceNumber: string;
  date: string | null;
  contactName: string;
  description: string;
  amountCents: number; // negative
  matchedDonorKey: string | null;
  matchedDonorName: string | null;
};

export type StatementBuild = {
  donors: Donor[];
  excludedLines: ExcludedLine[];
  unpaidGifts: (Gift & { contactName: string })[];
  creditNotes: CreditNote[];
  totals: {
    grandTotalCents: number; // included donors only
    giftCount: number;
    donorCount: number;
    missingEmailCount: number;
    flaggedCount: number;
    excludedDonorCount: number;
    excludedDonorCents: number;
    creditNoteCents: number;
  };
};

// ── Small pieces ─────────────────────────────────────────────

const cents = (n: number) => Math.round(n * 100);

/** "$1,000.00", "1000", "(50.00)", "-$5" → number. Null when unreadable. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s$,]|USD|US\$/gi, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

// Windows-1252 code points for bytes 0x80–0x9F, so text that was UTF-8 read
// as cp1252 ("â€™") can be turned back into bytes.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Repairs UTF-8 that was decoded as Latin-1/cp1252: "SamplÃ©" → "Samplé". */
export function fixEncoding(s: string): string {
  if (!/[ÃÂâ]/.test(s)) return s;
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x100) bytes.push(cp);
    else if (CP1252[cp] !== undefined) bytes.push(CP1252[cp]);
    else return s; // not mojibake
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return s;
  }
}

export function cleanName(s: string): string {
  return fixEncoding(s).replace(/\s+/g, " ").trim();
}

/** Grouping key: case, accents and punctuation don't separate donors. */
export function donorKey(name: string): string {
  return cleanName(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function ministryFor(description: string | null | undefined): Ministry {
  return /missio church/i.test(description ?? "") ? "Missio Church" : "Fire & Fragrance South Africa";
}

/** YYYY-MM-DD → MM-DD-YYYY, as printed on the statement. */
export function formatUsDate(ymd: string | null): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${m}-${d}-${y}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isValidEmail = (e: string | null | undefined) => !!e && EMAIL_RE.test(e.trim());

function containsWord(haystack: string, phrase: string): boolean {
  const esc = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return esc !== "" && new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, "i").test(haystack);
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase.trim() !== "" && haystack.toLowerCase().includes(phrase.trim().toLowerCase());
}

export function isCreditNoteNumber(invoiceNumber: string): boolean {
  return /^CN-/i.test(invoiceNumber.trim());
}

// ── Reading spreadsheets ─────────────────────────────────────

export type SheetKind = "xero_report" | "donations_list" | "contacts";

const norm = (v: unknown) => String(v ?? "").replace(/^\*/, "").trim().toLowerCase();

function findHeader(rows: unknown[][], required: string[], scan = 20): number {
  for (let i = 0; i < Math.min(rows.length, scan); i++) {
    const cells = (rows[i] ?? []).map(norm);
    if (required.every((r) => cells.includes(r))) return i;
  }
  return -1;
}

export function detectSheetKind(rows: unknown[][]): SheetKind | null {
  if (findHeader(rows, ["invoice number", "contact"]) >= 0) return "xero_report";
  if (findHeader(rows, ["donor name", "donation amount"]) >= 0) return "donations_list";
  if (findHeader(rows, ["contactname", "emailaddress"]) >= 0) return "contacts";
  return null;
}

/** Excel serial, Date, "1/2/2026", "2026-01-02", "02 Jan 2026" → YYYY-MM-DD. */
export function parseDateCell(v: unknown): string | null {
  const ymd = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  if (v instanceof Date && !isNaN(v.getTime())) return ymd(v);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return ymd(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000));
  }
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // US order — these are US reports (M/D/YYYY).
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const t = Date.parse(`${s} UTC`);
  return isNaN(t) ? null : ymd(new Date(t));
}

export type SheetParse = { lines: SourceLine[]; warnings: string[] };

/** Xero "Receivable Invoice Detail" export (titles above, header row, Total row). */
export function parseXeroReport(rows: unknown[][]): SheetParse {
  const h = findHeader(rows, ["invoice number", "contact"]);
  if (h < 0) return { lines: [], warnings: ["No header row with Invoice Number and Contact."] };
  const header = rows[h].map(norm);
  const col = (...names: string[]) => header.findIndex((c) => names.includes(c));
  const c = {
    number: col("invoice number"),
    date: col("invoice date"),
    item: col("item code"),
    desc: col("description"),
    qty: col("quantity"),
    currency: col("original currency", "currency"),
    unitUsd: col("unit price (ex) (usd)", "unit price (usd)", "unit price"),
    totalUsd: col("invoice total (usd)"),
    account: col("account code", "account"),
    contact: col("contact"),
    status: col("status"),
  };
  const warnings: string[] = [];
  if (c.unitUsd < 0) warnings.push("No “Unit Price (ex) (USD)” column — amounts can’t be read.");
  const lines: SourceLine[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const num = String(r[c.number] ?? "").trim();
    if (!num || /^total/i.test(num)) continue;
    const contact = String(r[c.contact] ?? "").trim();
    const unit = parseAmount(r[c.unitUsd]);
    const qty = c.qty >= 0 ? parseAmount(r[c.qty]) : 1;
    if (unit === null || qty === null) {
      warnings.push(`Row ${i + 1} (${num}): amount “${String(r[c.unitUsd] ?? "")}” couldn’t be read — skipped.`);
      continue;
    }
    lines.push({
      invoiceNumber: num,
      invoiceDate: parseDateCell(r[c.date]),
      contactName: contact,
      itemCode: c.item >= 0 ? String(r[c.item] ?? "").trim() || null : null,
      description: c.desc >= 0 ? String(r[c.desc] ?? "").trim() || null : null,
      accountCode: c.account >= 0 ? String(r[c.account] ?? "").trim() || null : null,
      quantity: qty,
      unitPriceUsd: unit,
      invoiceTotalUsd: c.totalUsd >= 0 ? parseAmount(r[c.totalUsd]) : null,
      currency: (c.currency >= 0 ? String(r[c.currency] ?? "").trim() : "") || "USD",
      status: c.status >= 0 ? xeroStatus(String(r[c.status] ?? "")) : "PAID",
    });
  }
  return { lines, warnings };
}

/** The report says "Paid" / "Approved"; the API says PAID / AUTHORISED. */
function xeroStatus(s: string): string {
  const t = s.trim().toUpperCase();
  if (t === "APPROVED") return "AUTHORISED";
  return t || "PAID";
}

/** The old script's input: Donor Name, Email Address, Donation Amount, Donation Date. */
export function parseDonationsList(rows: unknown[][]): SheetParse {
  const h = findHeader(rows, ["donor name", "donation amount"]);
  if (h < 0) return { lines: [], warnings: ["No header row with Donor Name and Donation Amount."] };
  const header = rows[h].map(norm);
  const c = {
    name: header.indexOf("donor name"),
    email: header.findIndex((x) => x === "email address" || x === "email"),
    amount: header.indexOf("donation amount"),
    date: header.findIndex((x) => x === "donation date" || x === "date"),
    ministry: header.indexOf("ministry"),
    number: header.findIndex((x) => x === "invoice number"),
  };
  const warnings: string[] = [];
  const lines: SourceLine[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = String(r[c.name] ?? "").trim();
    if (!name || /^total/i.test(name)) continue;
    const amount = parseAmount(r[c.amount]);
    if (amount === null) {
      warnings.push(`Row ${i + 1} (${name}): amount “${String(r[c.amount] ?? "")}” couldn’t be read — skipped.`);
      continue;
    }
    lines.push({
      invoiceNumber: (c.number >= 0 && String(r[c.number] ?? "").trim()) || `ROW-${i + 1}`,
      invoiceDate: c.date >= 0 ? parseDateCell(r[c.date]) : null,
      contactName: name,
      email: c.email >= 0 ? String(r[c.email] ?? "").trim() || null : null,
      description: c.ministry >= 0 ? String(r[c.ministry] ?? "").trim() || null : null,
      quantity: 1,
      unitPriceUsd: amount,
      invoiceTotalUsd: amount,
      currency: "USD",
      status: "PAID",
    });
  }
  return { lines, warnings };
}

/** Xero contacts export (*ContactName, EmailAddress) → donor key → email. */
export function parseContactsSheet(rows: unknown[][]): Record<string, string> {
  const h = findHeader(rows, ["contactname", "emailaddress"]);
  if (h < 0) return {};
  const header = rows[h].map(norm);
  const nameCol = header.indexOf("contactname");
  const emailCol = header.indexOf("emailaddress");
  const out: Record<string, string> = {};
  for (let i = h + 1; i < rows.length; i++) {
    const name = String(rows[i]?.[nameCol] ?? "").trim();
    const email = String(rows[i]?.[emailCol] ?? "").trim();
    if (name && email) out[donorKey(name)] = email;
  }
  return out;
}

/** A whole workbook (sheet name → rows) → lines + contact emails. */
export function parseWorkbook(sheets: Record<string, unknown[][]>): SheetParse & {
  contactEmails: Record<string, string>;
  used: { sheet: string; kind: SheetKind }[];
} {
  const lines: SourceLine[] = [];
  const warnings: string[] = [];
  const contactEmails: Record<string, string> = {};
  const used: { sheet: string; kind: SheetKind }[] = [];
  const kinds = Object.entries(sheets).map(([sheet, rows]) => ({ sheet, rows, kind: detectSheetKind(rows) }));
  // A workbook with a real Xero report uses that, not a derived list beside it.
  const hasReport = kinds.some((k) => k.kind === "xero_report");
  for (const { sheet, rows, kind } of kinds) {
    if (!kind) continue;
    if (kind === "contacts") {
      Object.assign(contactEmails, parseContactsSheet(rows));
      used.push({ sheet, kind });
    } else if (kind === "xero_report" || !hasReport) {
      const p = kind === "xero_report" ? parseXeroReport(rows) : parseDonationsList(rows);
      lines.push(...p.lines);
      warnings.push(...p.warnings.map((w) => `${sheet}: ${w}`));
      used.push({ sheet, kind });
    }
  }
  if (used.every((u) => u.kind === "contacts")) {
    warnings.push("No sheet looked like donations (a Xero Receivable Invoice Detail report, or Donor Name / Donation Amount columns).");
  }
  return { lines, warnings, contactEmails, used };
}

// ── The build ────────────────────────────────────────────────

export type BuildInput = {
  lines: SourceLine[];
  taxYear: number;
  options?: Partial<RunOptions>;
  rules?: Partial<ImportRules>;
  /** donor key → email, from Xero contacts or a contacts sheet. */
  contactEmails?: Record<string, string>;
  /** donor key → email, from Hub contacts (only unambiguous matches). */
  hubEmails?: Record<string, string>;
  edits?: DonorEdit[];
};

export function buildStatements(input: BuildInput): StatementBuild {
  const options = { ...DEFAULT_RUN_OPTIONS, ...input.options };
  const rules = { ...DEFAULT_IMPORT_RULES, ...input.rules };
  const excludedItems = new Set(rules.excludedItemCodes.map((c) => c.trim().toUpperCase()).filter(Boolean));
  const accounts = new Set(rules.accountCodes.map((c) => c.trim()).filter(Boolean));
  const yearPrefix = `${input.taxYear}-`;

  // 1. Line-level exclusions.
  const excludedLines: ExcludedLine[] = [];
  const kept: SourceLine[] = [];
  for (const line of input.lines) {
    const desc = line.description ?? "";
    const isCredit = isCreditNoteNumber(line.invoiceNumber) || line.quantity < 0;
    let reason: string | null = null;
    if (line.itemCode && excludedItems.has(line.itemCode.trim().toUpperCase())) {
      reason = `Not a donation (item ${line.itemCode})`;
    } else if (rules.excludedLinePhrases.some((p) => containsPhrase(desc, p))) {
      reason = "Not a donation (fee / pass-through line)";
    } else if (
      line.accountCode && accounts.size > 0 && !accounts.has(line.accountCode.trim()) &&
      // A credit note reversing a gift posts elsewhere (2850 — the gift moved
      // to a student's DTS) but must still be listed.
      !(isCredit && /donation/i.test(desc))
    ) {
      reason = isCredit ? "Credit note not for a donation" : `Account ${line.accountCode} isn't a donation account`;
    } else if (line.invoiceDate && !line.invoiceDate.startsWith(yearPrefix)) {
      reason = `Dated ${formatUsDate(line.invoiceDate)} — outside ${input.taxYear}`;
    } else if (line.currency.toUpperCase() !== "USD" && !options.includeNonUsd) {
      reason = `${line.currency.toUpperCase()} gift — non-USD gifts are left out`;
    } else if (!line.contactName.trim()) {
      reason = "No contact name";
    }
    if (reason) excludedLines.push({ line, reason });
    else kept.push(line);
  }

  // 2. Lines → gifts (one per invoice number).
  const byInvoice = new Map<string, SourceLine[]>();
  for (const line of kept) {
    const k = line.invoiceNumber.trim();
    (byInvoice.get(k) ?? byInvoice.set(k, []).get(k)!).push(line);
  }

  type Pending = { gift: Gift; contactName: string; paid: boolean };
  const pending: Pending[] = [];
  for (const [invoiceNumber, ls] of byInvoice) {
    const grossCents = ls.reduce((s, l) => s + cents(l.quantity * l.unitPriceUsd), 0);
    const total = ls.find((l) => l.invoiceTotalUsd !== null && l.invoiceTotalUsd !== undefined)?.invoiceTotalUsd;
    const netCents = total === null || total === undefined ? grossCents : cents(total);
    const descriptions = [...new Set(ls.map((l) => l.description ?? "").filter(Boolean))];
    pending.push({
      contactName: ls[0].contactName,
      paid: ls.every((l) => l.status.toUpperCase() === "PAID"),
      gift: {
        invoiceNumber,
        date: ls[0].invoiceDate,
        amountCents: options.amountBasis === "net" ? netCents : grossCents,
        grossCents,
        netCents,
        ministry: descriptions.some((d) => ministryFor(d) === "Missio Church") ? "Missio Church" : "Fire & Fragrance South Africa",
        descriptions,
        isCreditNote: isCreditNoteNumber(invoiceNumber) || grossCents < 0,
      },
    });
  }

  // 3. Gifts → donors. Credit notes and unpaid invoices are set aside.
  const unpaidGifts: StatementBuild["unpaidGifts"] = [];
  const creditPending: Pending[] = [];
  const donors = new Map<string, Donor>();
  const lineEmails = new Map<string, string>();
  for (const line of kept) {
    if (line.email && isValidEmail(line.email)) lineEmails.set(donorKey(line.contactName), line.email.trim());
  }

  const ensureDonor = (rawName: string): Donor => {
    const key = donorKey(rawName);
    let d = donors.get(key);
    if (!d) {
      d = {
        key, name: cleanName(rawName), sourceNames: [], email: null, emailSource: null, emailValid: false,
        gifts: [], totalCents: 0, flags: [], excluded: false, mergedFrom: [], note: null,
      };
      donors.set(key, d);
    }
    if (!d.sourceNames.includes(rawName)) d.sourceNames.push(rawName);
    return d;
  };

  for (const p of pending) {
    if (p.gift.isCreditNote) {
      if (p.gift.grossCents !== 0) creditPending.push(p); // a $0 credit note reverses nothing
    }
    else if (!p.paid) unpaidGifts.push({ ...p.gift, contactName: cleanName(p.contactName) });
    else ensureDonor(p.contactName).gifts.push(p.gift);
  }

  // 4. Finance's edits: merges first, then names, emails, exclusions.
  const edits = new Map((input.edits ?? []).map((e) => [e.donorKey, e]));
  for (const e of edits.values()) {
    if (!e.mergeIntoKey || e.mergeIntoKey === e.donorKey) continue;
    const from = donors.get(e.donorKey);
    const into = donors.get(e.mergeIntoKey);
    if (!from || !into) continue;
    into.gifts.push(...from.gifts);
    into.sourceNames.push(...from.sourceNames.filter((n) => !into.sourceNames.includes(n)));
    into.mergedFrom.push(from.name);
    if (!lineEmails.has(into.key) && lineEmails.has(from.key)) lineEmails.set(into.key, lineEmails.get(from.key)!);
    donors.delete(e.donorKey);
  }

  // 5. Credit notes: never a statement; matched to the donor they name.
  const creditNotes: CreditNote[] = creditPending.map((p) => {
    const description = p.gift.descriptions.join(" · ");
    const match = matchCreditNoteDonor(description, [...donors.values()]);
    return {
      invoiceNumber: p.gift.invoiceNumber,
      date: p.gift.date,
      contactName: cleanName(p.contactName),
      description,
      amountCents: p.gift.amountCents,
      matchedDonorKey: match?.key ?? null,
      matchedDonorName: match?.name ?? null,
    };
  });
  for (const cn of creditNotes) {
    const d = cn.matchedDonorKey ? donors.get(cn.matchedDonorKey) : undefined;
    if (!d) continue;
    d.flags.push({
      code: "credit_note",
      detail: `${cn.invoiceNumber} (${fmtUsd(cn.amountCents)}) names this donor: “${cn.description}”${options.creditNotes === "net" ? " — netted off" : ""}`,
    });
    if (options.creditNotes === "net") {
      const g = creditPending.find((p) => p.gift.invoiceNumber === cn.invoiceNumber)!.gift;
      d.gifts.push(g);
    }
  }

  // 6. Names, emails, totals, flags.
  const out: Donor[] = [];
  for (const d of donors.values()) {
    const e = edits.get(d.key);
    if (e?.displayName?.trim()) d.name = e.displayName.trim();
    d.excluded = e?.excluded === true;
    d.note = e?.note ?? null;

    const candidates: [EmailSource, string | undefined][] = [
      ["edit", e?.email?.trim() || undefined],
      ["source", lineEmails.get(d.key)],
      ["xero", input.contactEmails?.[d.key]],
      ["hub", input.hubEmails?.[d.key]],
    ];
    const hit = candidates.find(([, v]) => !!v);
    d.email = hit?.[1] ?? null;
    d.emailSource = hit?.[0] ?? null;
    d.emailValid = isValidEmail(d.email);

    d.gifts.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.invoiceNumber.localeCompare(b.invoiceNumber));
    d.totalCents = d.gifts.reduce((s, g) => s + g.amountCents, 0);

    if (!d.email) d.flags.push({ code: "missing_email", detail: "No email — post a paper statement" });
    else if (!d.emailValid) d.flags.push({ code: "invalid_email", detail: `“${d.email}” isn't a valid email` });

    const org = rules.organisationPhrases.find((p) => containsWord(d.name, p));
    if (org || / - /.test(d.name)) {
      d.flags.push({ code: "organisation", detail: `Looks like an organisation${org ? ` (“${org}”)` : ""} — confirm they get a statement` });
    }
    const garbled = d.sourceNames.find((n) => cleanName(n) !== n.replace(/\s+/g, " ").trim());
    if (garbled) {
      d.flags.push({ code: "encoding_fixed", detail: `Name repaired from “${garbled}” — fix the Xero contact too` });
    }
    if (d.name.split(" ").filter(Boolean).length < 2) {
      d.flags.push({ code: "incomplete_name", detail: "Only one name — check the Xero contact" });
    }
    for (const g of d.gifts) {
      const text = g.descriptions.join(" ");
      const phrase = rules.reviewLinePhrases.find((p) => containsPhrase(text, p));
      if (phrase) {
        d.flags.push({ code: "review_line", detail: `${g.invoiceNumber}: “${text}” — did they receive anything in return?` });
      }
      if (/\bDTS\b/i.test(text) && !g.isCreditNote) {
        d.flags.push({ code: "dts", detail: `${g.invoiceNumber}: “${text}” — gift toward a named student’s DTS` });
      }
    }
    if (d.totalCents <= 0) d.flags.push({ code: "not_positive", detail: "Total is zero or less — no statement" });
    out.push(d);
  }

  flagDuplicates(out);

  out.sort((a, b) => a.name.localeCompare(b.name));
  const included = out.filter((d) => !d.excluded && d.totalCents > 0);
  const excludedDonors = out.filter((d) => d.excluded || d.totalCents <= 0);
  return {
    donors: out,
    excludedLines,
    unpaidGifts,
    creditNotes,
    totals: {
      grandTotalCents: included.reduce((s, d) => s + d.totalCents, 0),
      giftCount: included.reduce((s, d) => s + d.gifts.filter((g) => !g.isCreditNote).length, 0),
      donorCount: included.length,
      missingEmailCount: included.filter((d) => !d.emailValid).length,
      flaggedCount: included.filter((d) => d.flags.some((f) => f.code !== "missing_email")).length,
      excludedDonorCount: excludedDonors.length,
      excludedDonorCents: excludedDonors.reduce((s, d) => s + Math.max(0, d.totalCents), 0),
      creditNoteCents: creditNotes.reduce((s, c) => s + c.amountCents, 0),
    },
  };
}

export function fmtUsd(c: number): string {
  const sign = c < 0 ? "-" : "";
  return `${sign}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const tokens = (name: string) => donorKey(name).split(" ").filter(Boolean);

/**
 * "DTS Donation - Sample Person 913" → the donor "Sample Q Person 913": every word of the
 * named person appears in the donor's name. Only a single clear match counts.
 */
export function matchCreditNoteDonor(description: string, donors: Pick<Donor, "key" | "name">[]): Pick<Donor, "key" | "name"> | null {
  // "Donation - DTS - Sample Person 914": the person is usually the last segment,
  // so try each segment after the first, last first.
  const segments = description.split(/\s+[-–]\s+/).slice(1).reverse();
  for (const seg of segments) {
    const want = tokens(seg);
    if (want.length < 2) continue;
    const hits = donors.filter((d) => {
      const have = new Set(tokens(d.name));
      return want.every((t) => have.has(t));
    });
    if (hits.length === 1) return hits[0];
    // Several donors contain the words: an exact name match still wins.
    const exact = hits.filter((d) => tokens(d.name).length === want.length);
    if (exact.length === 1) return exact[0];
    // "Sample (Nick) Person 901" → the donor "Sample Person 901": same first and last name.
    if (hits.length === 0) {
      const ends = donors.filter((d) => {
        const t = tokens(d.name);
        return t.length >= 2 && t[0] === want[0] && t[t.length - 1] === want[want.length - 1];
      });
      if (ends.length === 1) return ends[0];
    }
  }
  return null;
}

/** Same email under two names, or "Sample Person 901" / "Sample (Nick) Person 901". */
function flagDuplicates(donors: Donor[]) {
  const byEmail = new Map<string, Donor[]>();
  for (const d of donors) {
    if (!d.email) continue;
    const k = d.email.toLowerCase();
    (byEmail.get(k) ?? byEmail.set(k, []).get(k)!).push(d);
  }
  const pairs = new Set<string>();
  const flag = (a: Donor, b: Donor, why: string) => {
    const id = [a.key, b.key].sort().join("|");
    if (pairs.has(id)) return;
    pairs.add(id);
    a.flags.push({ code: "possible_duplicate", detail: `Same person as “${b.name}”? (${why}) — merge if so` });
    b.flags.push({ code: "possible_duplicate", detail: `Same person as “${a.name}”? (${why}) — merge if so` });
  };
  for (const group of byEmail.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) flag(group[i], group[j], "same email");
  }
  const toks = donors.map((d) => ({ d, t: tokens(d.name) }));
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      const a = toks[i], b = toks[j];
      if (a.t.length < 2 || b.t.length < 2) continue;
      if (a.t[0] !== b.t[0] || a.t[a.t.length - 1] !== b.t[b.t.length - 1]) continue;
      const [short, long] = a.t.length <= b.t.length ? [a.t, b.t] : [b.t, a.t];
      if (short.every((t) => long.includes(t))) flag(a.d, b.d, "similar name");
    }
  }
}

// ── Sending (phase 3) ────────────────────────────────────────

export type SendSkip = { key: string; name: string; reason: string };

/**
 * Which of the asked-for donors may be emailed now. Never: left-out
 * donors, zero totals, donors without a usable email (they get a paper
 * statement), and donors already sent this year — unless `resend`, which
 * is finance re-sending one on purpose (lost statement, corrected gift).
 */
export function planSends(
  donors: Donor[],
  askedKeys: string[],
  alreadySent: Set<string>,
  opts: { resend?: boolean } = {}
): { send: Donor[]; skipped: SendSkip[] } {
  const byKey = new Map(donors.map((d) => [d.key, d]));
  const send: Donor[] = [];
  const skipped: SendSkip[] = [];
  for (const key of [...new Set(askedKeys)]) {
    const d = byKey.get(key);
    if (!d) {
      skipped.push({ key, name: key, reason: "Not in this import" });
      continue;
    }
    const skip = (reason: string) => skipped.push({ key, name: d.name, reason });
    if (d.excluded) skip("Left out of statements");
    else if (d.totalCents <= 0) skip("Total is zero or less");
    else if (!d.emailValid) skip("No usable email — post a paper statement");
    else if (alreadySent.has(d.key) && !opts.resend) skip("Already sent this year");
    else send.push(d);
  }
  return { send, skipped };
}
