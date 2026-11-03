// Editing one unit (PATCH /api/equipment/units/[tag]). Pure, so the route
// and the tests agree on exactly what may change and how it reads in the
// unit's history. Only the fields the sheet and a shelf check can tell us:
// orders, tags and the product a unit belongs to are not edited here.

import { rands } from "./money";
import { shortDate } from "./register";

export const EDITABLE_UNIT_STATUSES = ["available", "maintenance", "retired"] as const;
export type EditableUnitStatus = (typeof EDITABLE_UNIT_STATUSES)[number];

export type UnitEditPatch = {
  label?: string | null;
  serial?: string | null;
  condition?: string | null;
  condition_note?: string | null;
  supplier?: string | null;
  purchase_date?: string | null;
  purchase_price_cents?: number | null;
  warranty_until?: string | null;
  last_checked_on?: string | null;
  location_id?: string | null;
  owner_label?: string | null;
  status?: EditableUnitStatus;
};

export type UnitEditField = keyof UnitEditPatch;

/** Free-text fields and their longest allowed value. */
const TEXT_FIELDS: Record<string, number> = {
  label: 100,
  serial: 200,
  condition: 200,
  condition_note: 2000,
  supplier: 200,
  owner_label: 200,
};
const DATE_FIELDS = ["purchase_date", "warranty_until", "last_checked_on"] as const;

export const UNIT_EDIT_FIELDS: UnitEditField[] = [
  "label",
  "serial",
  "condition",
  "condition_note",
  "supplier",
  "purchase_date",
  "purchase_price_cents",
  "warranty_until",
  "last_checked_on",
  "location_id",
  "owner_label",
  "status",
];

const FIELD_LABEL: Record<UnitEditField, string> = {
  label: "Label",
  serial: "Serial",
  condition: "Condition",
  condition_note: "Condition note",
  supplier: "Supplier",
  purchase_date: "Purchase date",
  purchase_price_cents: "Purchase price",
  warranty_until: "Warranty",
  last_checked_on: "Last checked",
  location_id: "Location",
  owner_label: "Assigned to",
  status: "Status",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "2026-04-30" and a real calendar day. */
export function isIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export type UnitEditResult = { ok: true; patch: UnitEditPatch } | { ok: false; error: string };

/**
 * Checks a request body and returns the clean patch. Text is trimmed and
 * blank becomes NULL. Any field outside UNIT_EDIT_FIELDS is refused rather
 * than ignored, so nobody thinks they changed a tag or a product.
 */
export function validateUnitEdit(body: unknown): UnitEditResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Expected an object" };
  const b = body as Record<string, unknown>;
  const patch: UnitEditPatch = {};

  for (const key of Object.keys(b)) {
    if (!(UNIT_EDIT_FIELDS as string[]).includes(key)) return { ok: false, error: `${key} can't be edited here` };
  }

  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    if (!(key in b)) continue;
    const v = b[key];
    if (v !== null && typeof v !== "string") return { ok: false, error: `${FIELD_LABEL[key as UnitEditField]} must be text` };
    const t = typeof v === "string" ? v.trim() : "";
    if (t.length > max) return { ok: false, error: `${FIELD_LABEL[key as UnitEditField]} is too long` };
    (patch as Record<string, unknown>)[key] = t === "" ? null : t;
  }

  for (const key of DATE_FIELDS) {
    if (!(key in b)) continue;
    const v = b[key];
    if (v === null || v === "") {
      patch[key] = null;
      continue;
    }
    if (typeof v !== "string" || !isIsoDate(v)) return { ok: false, error: `${FIELD_LABEL[key]} must be a date (YYYY-MM-DD)` };
    patch[key] = v;
  }

  if ("purchase_price_cents" in b) {
    const v = b.purchase_price_cents;
    if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000_000)) {
      return { ok: false, error: "Purchase price must be a whole number of cents" };
    }
    patch.purchase_price_cents = v as number | null;
  }

  if ("location_id" in b) {
    const v = b.location_id;
    if (v !== null && v !== "" && !(typeof v === "string" && UUID.test(v))) return { ok: false, error: "Bad location" };
    patch.location_id = v ? (v as string) : null;
  }

  if ("status" in b) {
    const v = b.status;
    if (typeof v !== "string" || !(EDITABLE_UNIT_STATUSES as readonly string[]).includes(v)) {
      return { ok: false, error: "Status must be available, maintenance or retired" };
    }
    patch.status = v as EditableUnitStatus;
  }

  return { ok: true, patch };
}

/** Only the fields that actually change. */
export function changedFields(current: Partial<Record<UnitEditField, unknown>>, patch: UnitEditPatch): UnitEditPatch {
  const out: UnitEditPatch = {};
  for (const key of Object.keys(patch) as UnitEditField[]) {
    const before = current[key] ?? null;
    const after = patch[key] ?? null;
    if (before !== after) (out as Record<string, unknown>)[key] = patch[key] ?? null;
  }
  return out;
}

/**
 * One line per change for the 'edited' event: Condition: “Broken” → “Working”.
 * Location ids are shown by name when the caller knows it.
 */
export function describeUnitChanges(
  current: Partial<Record<UnitEditField, unknown>>,
  changes: UnitEditPatch,
  locationName: (id: string) => string | undefined = () => undefined
): string[] {
  const show = (key: UnitEditField, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "none";
    if (key === "purchase_price_cents") return rands(v as number);
    if (key === "location_id") return locationName(v as string) ?? "another location";
    if ((DATE_FIELDS as readonly string[]).includes(key)) return shortDate(v as string);
    return `“${String(v)}”`;
  };
  return (Object.keys(changes) as UnitEditField[]).map(
    (key) => `${FIELD_LABEL[key]}: ${show(key, current[key])} → ${show(key, changes[key])}`
  );
}
