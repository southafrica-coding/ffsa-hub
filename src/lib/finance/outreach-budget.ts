/**
 * Outreach budget lines: the arithmetic and the sheet reader.
 *
 * A line is `amount × frequency × people`. People either follows the
 * team size or is a fixed number. The database trigger in migration 236
 * is the source of truth for stored totals; `lineTotal` here is the same
 * sum so the screen can move the instant someone types, before a save.
 *
 * The reader takes the finance team's sheet as they already keep it —
 *
 *     |                      | Amount  | Frequency | People | Total    |
 *     | Destination A – Food | R190.00 | 15        | 8      | R22 800  |
 *
 * — finds the header row by its words rather than by fixed columns, and
 * keeps every line (blank R0 placeholders included) so nothing in the
 * sheet silently disappears.
 */

export type BudgetCategory = { id: string; name: string; slug: string; sort_order: number };

export type BudgetLineInput = {
  amount_zar: number;
  frequency: number;
  uses_team_size: boolean;
  fixed_people: number;
};

export function linePeople(line: Pick<BudgetLineInput, "uses_team_size" | "fixed_people">, teamSize: number) {
  return line.uses_team_size ? teamSize : line.fixed_people;
}

export function lineTotal(line: BudgetLineInput, teamSize: number): number {
  const raw = Number(line.amount_zar) * Number(line.frequency) * linePeople(line, teamSize);
  return Math.round(raw * 100) / 100;
}

/** "R12,000.00", "R 1 200", "1200", 1200 → 1200. Blank / junk → null. */
export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value ?? "").trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export type ParsedSheetLine = {
  /** 0-based row in the sheet, for the preview */
  row: number;
  description: string;
  amount_zar: number;
  frequency: number;
  /** null when the sheet left People blank */
  people: number | null;
  sheet_total_zar: number | null;
};

export type ParsedSheet = {
  lines: ParsedSheetLine[];
  /** The People value most lines use — almost always the team size. */
  likelyTeamSize: number | null;
};

const SUMMARY_ROW = /^(grand\s+)?(sub\s*-?\s*)?totals?\b|^per\s+person\b|^total\s+(budget|cost)/i;

function cellText(c: unknown) {
  return String(c ?? "").trim();
}

/**
 * Returns null when no header row with Amount + (Frequency or People) +
 * Total can be found — i.e. this is not a budget sheet we understand.
 */
export function parseBudgetSheet(rows: unknown[][]): ParsedSheet | null {
  let headerRow = -1;
  let col = { amount: -1, frequency: -1, people: -1, total: -1 };

  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = (rows[i] ?? []).map((c) => cellText(c).toLowerCase());
    const find = (re: RegExp) => cells.findIndex((c) => re.test(c));
    const amount = find(/^(amount|cost|price|unit\s*(cost|price)?|rate)\b/);
    const frequency = find(/^(frequency|freq|qty|quantity|times|days|nights|#)\b/);
    const people = find(/^(people|persons?|pax|no\.?\s*of\s*people|number\s+of\s+people|team)\b/);
    const total = find(/^(total|sub\s*-?\s*total|amount\s+total)\b/);
    if (amount >= 0 && total >= 0 && (frequency >= 0 || people >= 0)) {
      headerRow = i;
      col = { amount, frequency, people, total };
      break;
    }
  }
  if (headerRow === -1) return null;

  const firstNumberCol = Math.min(
    ...[col.amount, col.frequency, col.people, col.total].filter((c) => c >= 0)
  );

  // The description is the left-of-numbers column with the most text in it.
  // Sheets often carry an empty spacer column A, so don't assume column 0.
  let descCol = 0;
  let best = -1;
  for (let c = 0; c < firstNumberCol; c++) {
    let filled = 0;
    for (let r = headerRow + 1; r < rows.length; r++) {
      const t = cellText(rows[r]?.[c]);
      if (t && parseMoney(t) === null) filled++;
    }
    if (filled > best) {
      best = filled;
      descCol = c;
    }
  }

  const lines: ParsedSheetLine[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const description = cellText(row[descCol]).replace(/\s+/g, " ");
    if (!description) continue;
    if (SUMMARY_ROW.test(description)) continue;

    const amount = parseMoney(row[col.amount]);
    const frequency = col.frequency >= 0 ? parseMoney(row[col.frequency]) : null;
    const people = col.people >= 0 ? parseMoney(row[col.people]) : null;
    const total = parseMoney(row[col.total]);

    lines.push({
      row: r,
      description,
      amount_zar: Math.max(0, amount ?? 0),
      // A blank frequency on a priced line means "once".
      frequency: Math.max(0, frequency ?? 1),
      people: people === null ? null : Math.max(0, Math.round(people)),
      sheet_total_zar: total,
    });
  }

  // Most common People value across priced lines.
  const counts = new Map<number, number>();
  for (const l of lines) {
    if (l.people && l.people > 0 && l.amount_zar > 0) {
      counts.set(l.people, (counts.get(l.people) ?? 0) + 1);
    }
  }
  let likelyTeamSize: number | null = null;
  let top = 0;
  for (const [size, n] of counts) {
    if (n > top || (n === top && likelyTeamSize !== null && size > likelyTeamSize)) {
      top = n;
      likelyTeamSize = size;
    }
  }

  return { lines, likelyTeamSize };
}

// Words a sheet uses → the category name they mean. Checked after a
// direct name match, so a real category name always wins.
const CATEGORY_SYNONYMS: [RegExp, string][] = [
  [/\bairport\s+(run|transfer|transport|shuttle|drop|pick)/i, "Airport Run"],
  [/\bairport\s+(meal|food|snack)/i, "Airport Meals"],
  [/\bflights?\b|\bair\s*fare|\bplane\b|\btickets?\b/i, "Flights"],
  [/\bvisas?\b/i, "Visas"],
  [/\baccom+o?d+ation|\baccom\b|\blodg|\bhotel|\bguest\s*house|\bhostel|\bairbnb|\bstay\b/i, "Accommodation"],
  [/\bfood\b|\bmeals?\b|\bgrocer|\bbreakfast|\blunch|\bdinner|\bcatering/i, "Food"],
  [/\btransport|\btaxi|\bbus\b|\bcar\s*hire|\bfuel|\bpetrol|\buber|\bkombi|\btravel\b/i, "Transport"],
  [/\btranslat|\binterpret/i, "Translator"],
  [/\bemergenc|\bcontingen/i, "Emergency Fund"],
  [/\bfirst\s*aid|\bmedic/i, "First Aid Kit"],
  [/\bgifts?\b|\bthank\s*you/i, "Gifts"],
  [/\bfun\b|\bouting|\bexcursion|\bday\s*off|\bsafari/i, "Fun"],
  [/\bbank\b|\batm\b|\bfees?\b|\bwithdrawal/i, "Bank Costs"],
  [/\bfinance\s*kit/i, "Finance Kit"],
  [/\bpastor|\bpastoral/i, "Pastoral Visit"],
  [/\bministry|\bevangeli|\bresources?\b|\bsupplies/i, "Ministry"],
  [/\bsurprise/i, "Surprise"],
];

/**
 * Best-guess category for a sheet line, or null. "Destination A – Food"
 * → Food; "Flights (with insurance)" → Flights; misspellings like
 * "Accomodation" still land.
 */
export function guessCategory(description: string, categories: BudgetCategory[]): BudgetCategory | null {
  const text = description.toLowerCase();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  // 1. A category name appears in the description — longest first, so
  //    "Airport Run" beats "Run" and "Emergency Fund" beats "Fund".
  const sorted = [...categories].sort((a, b) => b.name.length - a.name.length);
  for (const c of sorted) {
    const name = c.name.toLowerCase();
    if (name.length >= 3 && new RegExp(`\\b${escapeRe(name)}\\b`).test(text)) return c;
  }

  // 2. Known synonyms.
  for (const [re, name] of CATEGORY_SYNONYMS) {
    if (re.test(description)) {
      const c = byName.get(name.toLowerCase());
      if (c) return c;
    }
  }
  return null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
