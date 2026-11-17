// The pick list (/hire/request): for people who already know what they
// need. They choose products and quantities from what's free on their
// dates and send the list to the rental manager, who confirms it and
// replies with a quote. (When online checkout lands, the cart takes over.)
//
// Pure, so it can be tested:
//   - parsePickRequest: what the public page may send, strictly
//   - checkPickAgainstStock: the list against what's free right now; a line
//     that no longer fits is refused by name, never trimmed quietly
//   - summarisePick: the list laid out for the manager's email and notes

import { z } from "zod";
import { dayCount, isIsoDate } from "./dates";
import { CONTACT_ERRORS, CONTACT_SHAPE, FULFILMENT, labelOf, type HelperSummary, type ParseResult } from "./helper";
import { rands } from "./money";

export const MAX_PICK_LINES = 40;
const MAX_DAYS = 30;

const PICK = z
  .object({
    from: z.string().refine(isIsoDate),
    to: z.string().refine(isIsoDate),
    lines: z
      .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100) }).strict())
      .min(1)
      .max(MAX_PICK_LINES),
    fulfilment: z.enum(["collect", "delivery", "unsure"]),
    venue: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(200).optional()),
    ...CONTACT_SHAPE,
  })
  .strict();

export type PickRequest = z.infer<typeof PICK>;

const ERRORS: Record<string, string> = {
  from: "Pick the dates you need the gear.",
  to: "Pick the dates you need the gear.",
  lines: "Choose at least one item.",
  fulfilment: "Tell us whether you'll collect or need delivery.",
  ...CONTACT_ERRORS,
};

export function parsePickRequest(body: unknown, today: string): ParseResult<PickRequest> {
  const parsed = PICK.safeParse(body);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return { ok: false, error: ERRORS[field] ?? "Your list didn't come through. Check it and try again." };
  }
  const p = parsed.data;
  if (p.from < today) return { ok: false, error: "The collection date can't be in the past." };
  if (p.to < p.from) return { ok: false, error: "The return date can't be before the collection date." };
  if (dayCount(p.from, p.to) > MAX_DAYS) return { ok: false, error: "For more than a month, email us directly." };
  // The same product twice is one line.
  const merged = new Map<string, number>();
  for (const l of p.lines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);
  return { ok: true, value: { ...p, lines: Array.from(merged, ([productId, quantity]) => ({ productId, quantity })) } };
}

/** What the store knows about a product on the chosen dates. */
export type StockItem = {
  id: string;
  title: string;
  free: number;
  /** Per unit, for the whole period, excl. VAT. */
  priceCents: number;
  periodText: string;
  depositCents: number;
  maxPerOrder: number | null;
};

export type PricedLine = {
  productId: string;
  title: string;
  quantity: number;
  unitPriceCents: number;
  depositCents: number;
  lineTotalCents: number;
  periodText: string;
};

export type StockProblem = { productId: string; title: string; wanted: number; free: number };

export function checkPickAgainstStock(
  lines: PickRequest["lines"],
  stock: StockItem[]
): { ok: true; lines: PricedLine[] } | { ok: false; problems: StockProblem[] } {
  const byId = new Map(stock.map((s) => [s.id, s]));
  const problems: StockProblem[] = [];
  const priced: PricedLine[] = [];
  for (const l of lines) {
    const s = byId.get(l.productId);
    if (!s) {
      problems.push({ productId: l.productId, title: "An item", wanted: l.quantity, free: 0 });
      continue;
    }
    const allowed = Math.min(s.free, s.maxPerOrder ?? Infinity);
    if (l.quantity > allowed) {
      problems.push({ productId: s.id, title: s.title, wanted: l.quantity, free: Math.max(allowed, 0) });
      continue;
    }
    priced.push({
      productId: s.id,
      title: s.title,
      quantity: l.quantity,
      unitPriceCents: s.priceCents,
      depositCents: s.depositCents,
      lineTotalCents: s.priceCents * l.quantity,
      periodText: s.periodText,
    });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, lines: priced };
}

/** One sentence per line that no longer fits. */
export function problemText(p: StockProblem): string {
  if (p.free === 0) return `${p.title} isn't free on your dates any more.`;
  return `Only ${p.free} of ${p.title} ${p.free === 1 ? "is" : "are"} free on your dates. You asked for ${p.wanted}.`;
}

export function summarisePick(p: PickRequest, lines: PricedLine[]): HelperSummary {
  const hire = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const deposit = lines.reduce((sum, l) => sum + l.depositCents * l.quantity, 0);
  const flags: string[] = [];
  if (p.fulfilment === "delivery") flags.push("Wants delivery");

  const contact: [string, string][] = [
    ["Name", p.name],
    ["Email", p.email],
    ["Phone", p.phone],
  ];
  if (p.org) contact.push(["Organisation", p.org]);

  const details: [string, string][] = [
    ["Dates", p.from === p.to ? p.from : `${p.from} to ${p.to}`],
    ["Collect or delivery", labelOf(FULFILMENT, p.fulfilment) ?? p.fulfilment],
  ];
  if (p.venue) details.push(["Where", p.venue]);
  if (p.notes) details.push(["Anything else", p.notes]);

  return {
    flags,
    counts: [`Hire ${rands(hire)} excl. VAT, deposit ${rands(deposit)}, at store prices`],
    sections: [
      {
        title: "The gear they picked",
        rows: lines.map((l): [string, string] => [`${l.quantity}× ${l.title}`, `${rands(l.lineTotalCents)} ${l.periodText}`]),
      },
      { title: "The hire", rows: details },
      { title: "Contact", rows: contact },
    ],
  };
}
