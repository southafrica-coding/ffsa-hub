// ============================================================
// Per-tier signed waivers — shared model + logic (migration 163)
// ============================================================
// A tier can require a signable waiver / indemnity form (e.g. a youth
// camp parental-consent form). The organizer uploads the actual form as
// a PDF; at checkout the parent/guardian reads it, fills guardian + minor
// details, types their name as a signature and agrees. One signed record
// is captured per ATTENDEE — once per ticket of the waiver-required tier —
// exactly like the per-tier questions (ticket-questions.ts), and drained
// onto each issued ticket at fulfilment.
//
// This module is pure (no React, no DB) so the storefront, the checkout
// route and fulfilment all share one source of truth for how signatures
// line up with tickets.
// ============================================================

// Waiver CONFIG stored on ticket_types.waiver. A single object per tier
// (not an array). `document_path` points at the uploaded blank PDF in the
// private `waiver-documents` bucket; it's served to the parent at
// checkout via a signed URL.
export type TierWaiver = {
  enabled: boolean;
  version: string;
  title: string;
  // Optional supplementary text shown alongside the uploaded document
  // (e.g. "Read the attached form, then sign below").
  body_markdown: string;
  document_path: string | null;
  document_name: string | null;
  require_minor_name: boolean;
  require_relationship: boolean;
};

// The immutable signed record. Snapshots the exact title/version/document
// the guardian agreed to, so the record stays truthful even if the tier's
// waiver is later edited or the document replaced.
export type WaiverSignatureRecord = {
  version: string;
  title: string;
  document_name: string | null;
  guardian_name: string;
  relationship: string;
  minor_name: string;
  typed_signature: string;
  agreed: true;
  signed_at: string; // ISO
  ip: string | null;
  // Storage path of the generated signed certificate PDF, set at
  // fulfilment. Null until the ticket is issued.
  certificate_path?: string | null;
};

// Stored on orders.waiver_signatures — one entry per ticket whose tier
// requires a waiver. Fulfilment groups these by ticket_type_id (FIFO) and
// drains one onto each issued ticket's waiver_signature.
export type WaiverSignatureGroup = {
  ticket_type_id: string;
  signature: WaiverSignatureRecord;
};

// One signature-collecting block on the storefront: the i-th ticket of a
// tier that requires a waiver. `key` is stable for React + state maps.
export type WaiverSlot = {
  key: string;
  ticketTypeId: string;
  ticketTypeName: string;
  index: number; // 0-based position within this tier
  waiver: TierWaiver;
};

// The raw values a parent enters for one waiver slot.
export type WaiverSlotValues = {
  guardian_name?: string;
  relationship?: string;
  minor_name?: string;
  typed_signature?: string;
  agreed?: boolean;
};

export function waiverSlotKey(ticketTypeId: string, index: number): string {
  return `${ticketTypeId}:${index}`;
}

// True when a tier's waiver is present, enabled and has an uploaded
// document to sign. A waiver with no document isn't collectable yet.
export function isWaiverActive(waiver: TierWaiver | null | undefined): boolean {
  return !!waiver && waiver.enabled === true && !!waiver.document_path;
}

// Coerce/validate an incoming waiver config (from the admin editor) into a
// clean, well-formed object — or null to clear it. Never trusts client
// shape. `document_path`/`document_name` are preserved from the incoming
// payload (the upload route sets them); everything else is normalized.
export function sanitizeWaiver(input: unknown): TierWaiver | null {
  if (input == null) return null;
  if (typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const title =
    typeof r.title === "string" && r.title.trim()
      ? r.title.trim()
      : "Waiver & Indemnity Form";
  const version =
    typeof r.version === "string" && r.version.trim()
      ? r.version.trim()
      : "1";
  return {
    enabled: r.enabled === true,
    version,
    title,
    body_markdown:
      typeof r.body_markdown === "string" ? r.body_markdown.trim() : "",
    document_path:
      typeof r.document_path === "string" && r.document_path.trim()
        ? r.document_path.trim()
        : null,
    document_name:
      typeof r.document_name === "string" && r.document_name.trim()
        ? r.document_name.trim()
        : null,
    require_minor_name: r.require_minor_name !== false, // default on
    require_relationship: r.require_relationship !== false, // default on
  };
}

// Validate one slot's entered values against its waiver's requirements.
// Returns per-field errors keyed by the field name.
export function validateWaiverValues(
  waiver: TierWaiver,
  values: WaiverSlotValues
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const guardian = (values.guardian_name ?? "").trim();
  const signature = (values.typed_signature ?? "").trim();
  const minor = (values.minor_name ?? "").trim();
  const relationship = (values.relationship ?? "").trim();

  if (!guardian) errors.guardian_name = "Parent/guardian full name is required";
  if (waiver.require_relationship && !relationship) {
    errors.relationship = "Relationship to the attendee is required";
  }
  if (waiver.require_minor_name && !minor) {
    errors.minor_name = "The attendee's full name is required";
  }
  if (!signature) {
    errors.typed_signature = "Please type your full name to sign";
  } else if (guardian && signature.toLowerCase() !== guardian.toLowerCase()) {
    errors.typed_signature =
      "Signature must match the parent/guardian name above";
  }
  if (values.agreed !== true) {
    errors.agreed = "You must agree to the form to continue";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

// Freeze an entered slot into the immutable signed record.
export function snapshotWaiverSignature(
  waiver: TierWaiver,
  values: WaiverSlotValues,
  meta: { signedAt: string; ip: string | null }
): WaiverSignatureRecord {
  return {
    version: waiver.version,
    title: waiver.title,
    document_name: waiver.document_name,
    guardian_name: (values.guardian_name ?? "").trim(),
    relationship: (values.relationship ?? "").trim(),
    minor_name: (values.minor_name ?? "").trim(),
    typed_signature: (values.typed_signature ?? "").trim(),
    agreed: true,
    signed_at: meta.signedAt,
    ip: meta.ip,
    certificate_path: null,
  };
}

// Expand the current cart into per-ticket waiver blocks. Only tiers whose
// waiver is active produce slots; cart order is preserved.
export function computeWaiverSlots(
  cart: Array<{ ticketTypeId: string; ticketTypeName: string; qty: number }>,
  waiverByTier: Record<string, TierWaiver | null | undefined>
): WaiverSlot[] {
  const slots: WaiverSlot[] = [];
  for (const line of cart) {
    const waiver = waiverByTier[line.ticketTypeId];
    if (!isWaiverActive(waiver)) continue;
    for (let i = 0; i < line.qty; i++) {
      slots.push({
        key: waiverSlotKey(line.ticketTypeId, i),
        ticketTypeId: line.ticketTypeId,
        ticketTypeName: line.ticketTypeName,
        index: i,
        waiver: waiver as TierWaiver,
      });
    }
  }
  return slots;
}

// Client-side: validate every slot and build the checkout payload. Errors
// are returned per slot so the storefront can show them under the right
// block.
export function collectWaiverSignatures(
  slots: WaiverSlot[],
  valuesBySlot: Record<string, WaiverSlotValues>
): {
  valid: boolean;
  errors: Record<string, Record<string, string>>;
  payload: Array<{ ticket_type_id: string; values: WaiverSlotValues }>;
} {
  const errors: Record<string, Record<string, string>> = {};
  const payload: Array<{ ticket_type_id: string; values: WaiverSlotValues }> =
    [];
  for (const slot of slots) {
    const values = valuesBySlot[slot.key] ?? {};
    const v = validateWaiverValues(slot.waiver, values);
    if (!v.valid) errors[slot.key] = v.errors;
    payload.push({ ticket_type_id: slot.ticketTypeId, values });
  }
  return { valid: Object.keys(errors).length === 0, errors, payload };
}

// Server-side authority: rebuild the expected slots from the resolved
// cart lines (never trust client counts), match provided signatures per
// tier in order, validate, and snapshot into storable groups. Enforces
// the requirement even if the client omits a slot.
export function buildWaiverSignatureGroups(
  resolved: Array<{
    ticketTypeId: string;
    qty: number;
    waiver: TierWaiver | null | undefined;
  }>,
  provided: Array<{ ticket_type_id?: string; values?: WaiverSlotValues }>,
  meta: { signedAt: string; ip: string | null }
): { valid: boolean; error?: string; groups: WaiverSignatureGroup[] } {
  const queues = new Map<string, WaiverSlotValues[]>();
  for (const entry of provided) {
    const id = entry?.ticket_type_id;
    if (!id) continue;
    const values =
      entry.values && typeof entry.values === "object" ? entry.values : {};
    const q = queues.get(id) ?? [];
    q.push(values);
    queues.set(id, q);
  }

  const groups: WaiverSignatureGroup[] = [];
  for (const line of resolved) {
    if (!isWaiverActive(line.waiver)) continue;
    const waiver = line.waiver as TierWaiver;
    const q = queues.get(line.ticketTypeId) ?? [];
    for (let i = 0; i < line.qty; i++) {
      const values = q.shift() ?? {};
      const v = validateWaiverValues(waiver, values);
      if (!v.valid) {
        return {
          valid: false,
          error: `Please complete and sign the "${waiver.title}" for each ticket.`,
          groups: [],
        };
      }
      groups.push({
        ticket_type_id: line.ticketTypeId,
        signature: snapshotWaiverSignature(waiver, values, meta),
      });
    }
  }
  return { valid: true, groups };
}

// Fulfilment: hand back a FIFO drainer that yields the next signature for
// a given tier. Tiers without waivers — or once exhausted — yield null.
export function waiverSignatureDrainer(
  groups: WaiverSignatureGroup[] | null | undefined
): (ticketTypeId: string) => WaiverSignatureRecord | null {
  const queues = new Map<string, WaiverSignatureRecord[]>();
  for (const g of groups ?? []) {
    if (!g || typeof g.ticket_type_id !== "string" || !g.signature) continue;
    const q = queues.get(g.ticket_type_id) ?? [];
    q.push(g.signature);
    queues.set(g.ticket_type_id, q);
  }
  return (ticketTypeId: string) => queues.get(ticketTypeId)?.shift() ?? null;
}
