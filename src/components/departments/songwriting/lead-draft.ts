// The lead form's draft and its conversion to LeadInput. Pure.
// created_by and last_contact_at are 424's: they are not in the draft, so
// they can never reach a request body.

import { isUuid } from "@/lib/departments/validate";
import { LEAD_KINDS, LEAD_STATUSES, type LeadInput, type LeadKind, type LeadStatus, type SongwritingLead } from "./types";

export type LeadDraft = {
  label: string;
  kind: LeadKind;
  status: LeadStatus;
  nation_id: string;
  source_training_id: string;
  /** "" = unassigned. */
  owner_user_id: string;
  /** A Hub account id, or "". */
  contact_user_id: string;
  note: string;
};

export const LEAD_KIND_LABEL: Record<LeadKind, string> = {
  person: "Person",
  organisation: "Organisation",
  group: "Group",
};

export { LEAD_KINDS, LEAD_STATUSES };

export function leadToDraft(lead: SongwritingLead | null, defaults: Partial<LeadDraft> = {}): LeadDraft {
  return {
    label: lead?.label ?? "",
    kind: lead?.kind ?? "person",
    status: lead?.status ?? "new",
    nation_id: lead?.nation_id ?? "",
    source_training_id: lead?.source_training_id ?? "",
    owner_user_id: lead?.owner_user_id ?? "",
    contact_user_id: lead?.contact_user_id ?? "",
    note: lead?.note ?? "",
    ...(lead ? {} : defaults),
  };
}

export function leadToInput(d: LeadDraft): { input: LeadInput } | { fields: string[] } {
  const fields: string[] = [];
  const label = d.label.trim();
  if (!label || label.length > 200) fields.push("label");
  if (!(LEAD_KINDS as readonly string[]).includes(d.kind)) fields.push("kind");
  if (!(LEAD_STATUSES as readonly string[]).includes(d.status)) fields.push("status");
  const contact = d.contact_user_id.trim();
  if (contact && !isUuid(contact)) fields.push("contact_user_id");
  if (d.owner_user_id && !isUuid(d.owner_user_id)) fields.push("owner_user_id");
  if (d.nation_id && !isUuid(d.nation_id)) fields.push("nation_id");
  if (d.source_training_id && !isUuid(d.source_training_id)) fields.push("source_training_id");
  if (d.note.trim().length > 4000) fields.push("note");
  if (fields.length) return { fields };
  return {
    input: {
      label,
      kind: d.kind,
      status: d.status,
      contact_user_id: contact || null,
      source_training_id: d.source_training_id || null,
      nation_id: d.nation_id || null,
      note: d.note.trim() || null,
      owner_user_id: d.owner_user_id || null,
    },
  };
}
