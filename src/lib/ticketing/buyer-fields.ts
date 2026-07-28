// ============================================================
// Configurable buyer detail fields — shared model (migration 140)
// ============================================================
// Controls the standard "Your details" section collected once per order
// at checkout: first name, last name, email, phone, marketing opt-in.
// Each field can be shown/hidden and marked required — except email,
// which is always enabled + required (the ticket/receipt email and CRM
// dedup both depend on it). Stored on events.buyer_fields.
//
// Separate from event-level checkout questions and per-tier per-ticket
// questions — this layer is only the built-in buyer fields, so the
// storefronts and the checkout validator share one source of truth for
// which are shown and which are required.
// ============================================================

export type BuyerFieldKey =
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "marketing_consent";

export type BuyerFieldConfig = {
  key: BuyerFieldKey;
  enabled: boolean;
  // Whether a value must be provided. Not meaningful for
  // marketing_consent (an opt-in is never "required"); ignored there.
  required: boolean;
};

// Canonical order + built-in defaults — the behaviour before this feature:
// first/last/email required, phone shown but optional, opt-in shown.
export const BUYER_FIELD_ORDER: BuyerFieldKey[] = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "marketing_consent",
];

export const BUYER_FIELD_LABELS: Record<BuyerFieldKey, string> = {
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  marketing_consent: "Marketing opt-in",
};

const DEFAULTS: Record<BuyerFieldKey, { enabled: boolean; required: boolean }> = {
  first_name: { enabled: true, required: true },
  last_name: { enabled: true, required: true },
  email: { enabled: true, required: true },
  phone: { enabled: true, required: false },
  marketing_consent: { enabled: true, required: false },
};

// Email is structurally mandatory — the resolver forces it on + required
// no matter what's stored, and the admin UI shows it locked.
export const LOCKED_FIELDS: BuyerFieldKey[] = ["email"];

// Consent is a boolean opt-in; "required" is never applicable.
export function requiredApplies(key: BuyerFieldKey): boolean {
  return key !== "marketing_consent";
}

export function isBuyerFieldKey(s: unknown): s is BuyerFieldKey {
  return (
    typeof s === "string" &&
    (BUYER_FIELD_ORDER as string[]).includes(s)
  );
}

// Merge stored config over the built-in defaults, always in canonical
// order, always with every key present, and with locked fields forced.
// This is the single function the storefronts + checkout validator call,
// so a partial or empty stored value can never produce a broken form.
export function resolveBuyerFields(raw: unknown): BuyerFieldConfig[] {
  const stored = new Map<BuyerFieldKey, Partial<BuyerFieldConfig>>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      if (!isBuyerFieldKey(r.key)) continue;
      stored.set(r.key, {
        enabled: typeof r.enabled === "boolean" ? r.enabled : undefined,
        required: typeof r.required === "boolean" ? r.required : undefined,
      });
    }
  }

  return BUYER_FIELD_ORDER.map((key) => {
    const d = DEFAULTS[key];
    const s = stored.get(key) ?? {};
    const locked = LOCKED_FIELDS.includes(key);
    const enabled = locked ? true : s.enabled ?? d.enabled;
    let required = requiredApplies(key)
      ? s.required ?? d.required
      : false;
    if (locked) required = true;
    // A hidden field can't be required — nothing collects it.
    if (!enabled) required = false;
    return { key, enabled, required };
  });
}

// Sanitize an incoming admin payload down to well-formed config before
// storing. Returns the resolved (locked-enforced) array so what's saved is
// exactly what will be applied.
export function sanitizeBuyerFields(input: unknown): BuyerFieldConfig[] {
  return resolveBuyerFields(input);
}

// Convenience lookup used by the checkout validator + storefronts.
export function buyerFieldMap(
  config: BuyerFieldConfig[]
): Record<BuyerFieldKey, BuyerFieldConfig> {
  const m = {} as Record<BuyerFieldKey, BuyerFieldConfig>;
  for (const c of config) m[c.key] = c;
  // Guard: ensure every key exists even if given a partial array.
  return { ...toRecord(resolveBuyerFields([])), ...m };
}

function toRecord(
  config: BuyerFieldConfig[]
): Record<BuyerFieldKey, BuyerFieldConfig> {
  const m = {} as Record<BuyerFieldKey, BuyerFieldConfig>;
  for (const c of config) m[c.key] = c;
  return m;
}
