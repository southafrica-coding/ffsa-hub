// Inventory (stage O, migrations 381–383). Pure rules shared by the routes,
// the screens and the tests: how an item is tracked, what a new item needs,
// which stock changes exist and who may make them, and what a count on a
// returned order must add up to. No database, no clock.
//
//   tagged      one row per thing, each with a tag (the sound gear)
//   counted     one row, a quantity. Lent and returned. (60 glasses)
//   consumable  a quantity that only goes down when handed out (tealights)

import { parseRands } from "./listing";

export const TRACKINGS = ["counted", "tagged", "consumable"] as const;
export type Tracking = (typeof TRACKINGS)[number];

export const TRACKING_LABEL: Record<Tracking, string> = {
  counted: "Counted",
  tagged: "Tagged",
  consumable: "Consumable",
};

export const TRACKING_HELP: Record<Tracking, string> = {
  counted: "We keep a count: glasses, tablecloths, vases. Lent out and counted back in.",
  tagged: "Each one gets its own tag and QR: speakers, mics, cameras.",
  consumable: "Gets used up: tealights, paper plates, balloons. Handed out, never returned.",
};

// ── Stock moves ────────────────────────────────────────────

export const MOVE_REASONS = ["bought", "found", "handed_out", "lost", "damaged", "correction", "opening"] as const;
export type MoveReason = (typeof MOVE_REASONS)[number];

export const MOVE_LABEL: Record<MoveReason, string> = {
  opening: "First count",
  bought: "Bought more",
  found: "Found / repaired",
  handed_out: "Handed out",
  lost: "Lost",
  damaged: "Damaged",
  correction: "Recount",
};

/** +1: adds to stock, -1: takes away, 0: either (a recount sets the new total). */
export const MOVE_SIGN: Record<MoveReason, 1 | -1 | 0> = {
  opening: 1,
  bought: 1,
  found: 1,
  handed_out: -1,
  lost: -1,
  damaged: -1,
  correction: 0,
};

/** The changes offered on an item's page, by how it is tracked and who is asking. */
export function moveReasonsFor(tracking: Tracking, canManage: boolean): MoveReason[] {
  if (tracking === "tagged") return [];
  const base: MoveReason[] =
    tracking === "consumable" ? ["bought", "handed_out", "lost", "found"] : ["bought", "found", "lost", "damaged"];
  return canManage ? [...base, "correction"] : base;
}

export type MoveInput = {
  reason: MoveReason;
  /** For a recount: the new total. Otherwise: how many. Always positive or zero. */
  quantity: number;
  note: string | null;
  supplier: string | null;
  unitCostCents: number | null;
  happenedOn: string | null;
};

export type MoveRow = {
  delta: number;
  reason: MoveReason;
  note: string | null;
  supplier: string | null;
  unit_cost_cents: number | null;
  happened_on?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length > max) return undefined;
  return t || null;
}

function wholeNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Reads a stock change from a form body. */
export function readMove(body: Record<string, unknown>): { move: MoveInput } | { error: string } {
  const reason = body.reason;
  if (typeof reason !== "string" || !(MOVE_REASONS as readonly string[]).includes(reason) || reason === "opening") {
    return { error: "Pick what happened." };
  }
  const quantity = wholeNumber(body.quantity, 0, 100_000);
  if (quantity === null) return { error: "How many has to be a whole number." };
  if (reason !== "correction" && quantity === 0) return { error: "How many has to be more than 0." };
  const note = text(body.note, 500);
  const supplier = text(body.supplier, 120);
  if (note === undefined) return { error: "The note is too long." };
  if (supplier === undefined) return { error: "The supplier name is too long." };
  let unitCostCents: number | null = null;
  if (body.unitCost !== undefined && body.unitCost !== null && body.unitCost !== "") {
    const c = typeof body.unitCost === "number" ? Math.round(body.unitCost * 100) : parseRands(String(body.unitCost));
    if (c === null || Number.isNaN(c) || c < 0) return { error: "The price each must be an amount in rand, like 45 or 45.50." };
    unitCostCents = c;
  }
  const happenedOn = typeof body.happenedOn === "string" && ISO_DATE.test(body.happenedOn) ? body.happenedOn : null;
  if (["lost", "damaged", "correction"].includes(reason) && !note) {
    return { error: "Say what happened in the note." };
  }
  return { move: { reason: reason as MoveReason, quantity, note, supplier, unitCostCents, happenedOn } };
}

/** Turns a change into the row to insert, checked against today's stock. */
export function moveRow(
  move: MoveInput,
  tracking: Tracking,
  stock: number,
  canManage: boolean
): { row: MoveRow } | { error: string } {
  if (!moveReasonsFor(tracking, canManage).includes(move.reason)) {
    return {
      error:
        move.reason === "correction"
          ? "Only the inventory manager can recount."
          : `“${MOVE_LABEL[move.reason]}” doesn't apply to a ${TRACKING_LABEL[tracking].toLowerCase()} item.`,
    };
  }
  let delta: number;
  if (move.reason === "correction") {
    delta = move.quantity - stock;
    if (delta === 0) return { error: `The count is already ${stock}.` };
  } else {
    delta = MOVE_SIGN[move.reason] * move.quantity;
  }
  if (stock + delta < 0) {
    return { error: `There ${stock === 1 ? "is" : "are"} only ${stock} in stock.` };
  }
  return {
    row: {
      delta,
      reason: move.reason,
      note: move.note,
      supplier: move.reason === "bought" ? move.supplier : null,
      unit_cost_cents: move.reason === "bought" ? move.unitCostCents : null,
      ...(move.happenedOn ? { happened_on: move.happenedOn } : {}),
    },
  };
}

// ── A new item ─────────────────────────────────────────────

export type NewItem = {
  tracking: Tracking;
  name: string;
  description: string;
  category: string;
  brand: string | null;
  model: string | null;
  locationId: string | null;
  /** counted / consumable: how many we have now. tagged: how many units to create. */
  quantity: number;
  /** tagged only: the tag prefix, e.g. "AUD". */
  tagPrefix: string | null;
  supplier: string | null;
  purchaseDate: string | null;
  /** What one cost, cents. */
  unitCostCents: number | null;
  isRequestable: boolean;
  reorderAt: number | null;
};

/** Reads the Add item form. Every message is something the manager can act on. */
export function readNewItem(body: Record<string, unknown>): { item: NewItem } | { error: string } {
  const tracking = body.tracking;
  if (typeof tracking !== "string" || !(TRACKINGS as readonly string[]).includes(tracking)) {
    return { error: "Pick how it's tracked: counted, tagged or consumable." };
  }
  const t = tracking as Tracking;
  const name = text(body.name, 120);
  if (!name) return { error: "Give it a name." };
  const description = text(body.description, 4000);
  if (!description) return { error: "Describe it: what it is, size, colour, anything that tells it apart." };
  const category = text(body.category, 40);
  if (!category) return { error: "Pick or type a category." };
  const brand = text(body.brand, 80);
  const model = text(body.model, 80);
  if (brand === undefined || model === undefined) return { error: "Brand or model is too long." };
  const locationId = typeof body.locationId === "string" && body.locationId ? body.locationId : null;

  const quantity = wholeNumber(body.quantity, t === "tagged" ? 1 : 0, t === "tagged" ? 200 : 100_000);
  if (quantity === null) {
    return { error: t === "tagged" ? "How many units? Between 1 and 200 at a time." : "How many do we have? A whole number." };
  }
  let tagPrefix: string | null = null;
  if (t === "tagged") {
    const p = typeof body.tagPrefix === "string" ? body.tagPrefix.trim().toUpperCase() : "";
    if (!/^[A-Z]{2,5}$/.test(p)) return { error: "The tag prefix is 2 to 5 letters, like AUD." };
    tagPrefix = p;
  }
  const supplier = text(body.supplier, 120);
  if (supplier === undefined) return { error: "The supplier name is too long." };
  const purchaseDate = typeof body.purchaseDate === "string" && ISO_DATE.test(body.purchaseDate) ? body.purchaseDate : null;
  let unitCostCents: number | null = null;
  if (body.unitCost !== undefined && body.unitCost !== null && body.unitCost !== "") {
    const c = parseRands(String(body.unitCost));
    if (c === null || Number.isNaN(c)) return { error: "The price each must be an amount in rand, like 45 or 45.50." };
    unitCostCents = c;
  }
  const reorderAt =
    t === "consumable" && body.reorderAt !== undefined && body.reorderAt !== null && body.reorderAt !== ""
      ? wholeNumber(body.reorderAt, 0, 100_000)
      : null;
  if (t === "consumable" && body.reorderAt && reorderAt === null) return { error: "“Reorder at” has to be a whole number." };

  return {
    item: {
      tracking: t,
      name,
      description,
      category: category.toLowerCase(),
      brand: brand ?? null,
      model: model ?? null,
      locationId,
      quantity,
      tagPrefix,
      supplier: supplier ?? null,
      purchaseDate,
      unitCostCents,
      // Consumables are never lent (constraint consumables_not_booked).
      isRequestable: t !== "consumable" && body.isRequestable !== false,
      reorderAt,
    },
  };
}

/** "Small green glass vases" → "small-green-glass-vases", unique against `taken`. */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item";
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) {
    const s = `${base}-${i}`;
    if (!set.has(s)) return s;
  }
}

/** The next `n` free tags after the highest PREFIX-#### already used. */
export function nextTags(prefix: string, existing: Iterable<string>, n: number): string[] {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const tag of existing) {
    const m = re.exec(tag);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: n }, (_, i) => `${prefix}-${String(max + 1 + i).padStart(4, "0")}`);
}

// ── Counting an order out and back ─────────────────────────

export type CountInput =
  | { stage: "out"; count: number; note: string | null }
  | { stage: "back"; count: number; damaged: number; missing: number; note: string | null };

/** Checks a count against the line before it reaches the database (which checks again). */
export function readCount(
  body: Record<string, unknown>,
  line: { quantity: number; qty_out: number | null; qty_back: number | null }
): { count: CountInput } | { error: string } {
  const note = text(body.note, 500);
  if (note === undefined) return { error: "The note is too long." };
  const count = wholeNumber(body.count, 0, 100_000);
  if (count === null) return { error: "Counts are whole numbers." };
  if (body.stage === "out") {
    if (line.qty_back !== null) return { error: "This line is already counted back in." };
    if (count > line.quantity) return { error: `Only ${line.quantity} were booked.` };
    return { count: { stage: "out", count, note } };
  }
  if (body.stage === "back") {
    if (line.qty_out === null) return { error: "Count it out first." };
    if (line.qty_back !== null) return { error: "This line is already counted back in." };
    const damaged = wholeNumber(body.damaged ?? 0, 0, 100_000);
    const missing = wholeNumber(body.missing ?? 0, 0, 100_000);
    if (damaged === null || missing === null) return { error: "Counts are whole numbers." };
    if (count + damaged + missing !== line.qty_out) {
      return {
        error: `${line.qty_out} went out. Back, damaged and missing have to add up to ${line.qty_out} (now ${count + damaged + missing}).`,
      };
    }
    if (damaged + missing > 0 && !note) return { error: "Say what happened to the damaged or missing ones." };
    return { count: { stage: "back", count, damaged, missing, note } };
  }
  return { error: "Count out or count back?" };
}

/** What the register says about a counted or consumable item, or "" when nothing. */
export function stockAttention(p: {
  tracking: Tracking;
  stock: number;
  reorderAt: number | null;
  description: string | null;
}): string {
  const out: string[] = [];
  if (p.tracking === "consumable" && p.reorderAt !== null && p.stock <= p.reorderAt) out.push(`Reorder (${p.stock} left)`);
  if (p.tracking !== "tagged" && p.stock === 0) out.push("None in stock");
  if (!p.description) out.push("No description yet");
  return out.join(" · ");
}

/** The database's error codes (381) in plain words. */
export function inventoryErrorText(message: string): string {
  if (message.includes("EQUIPMENT_STOCK_NEGATIVE")) return "That would take the stock below zero.";
  if (message.includes("EQUIPMENT_NOTE_NEEDED")) return "Say what happened to the damaged or missing ones.";
  if (message.includes("EQUIPMENT_BAD_COUNT")) return "Those counts don't add up.";
  if (message.includes("EQUIPMENT_ALREADY_BACK")) return "This line is already counted back in.";
  if (message.includes("EQUIPMENT_NOT_OUT")) return "Count it out first.";
  if (message.includes("EQUIPMENT_ORDER_NOT_READY")) return "Approve the order before counting it out.";
  if (message.includes("EQUIPMENT_NOT_ALLOWED")) return "Only the inventory team can count orders.";
  if (message.includes("EQUIPMENT_NOT_COUNTED")) return "Tagged gear is scanned, not counted.";
  return message;
}
