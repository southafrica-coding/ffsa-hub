// ────────────────────────────────────────────────────────────
// EDITABLE PROFILE PAGE — section layout
// ────────────────────────────────────────────────────────────
// The /profile page renders every user-editable field, grouped into
// cards. Field configs are reused verbatim from profile-fields.ts so the
// page, the onboarding flow and the blocking gate can never disagree on
// how a field is collected. We add only the two fields the gate doesn't
// enforce (preferred_name, address_line_2) plus the passport/visa fields
// (shown to everyone, optional unless the user is flagged international
// elsewhere). Every field listed here is on the /api/profile/update
// safelist.

import {
  REQUIRED_PROFILE_FIELDS,
  PASSPORT_VISA_BASE_FIELDS,
  VISA_LONG_TERM_FIELDS,
  type FieldConfig,
} from "./profile-fields";

// Index every known config by its column so sections can be composed by
// name without restating options lists.
const POOL: Record<string, FieldConfig> = {};
for (const f of [
  ...REQUIRED_PROFILE_FIELDS,
  ...PASSPORT_VISA_BASE_FIELDS,
  ...VISA_LONG_TERM_FIELDS,
]) {
  POOL[f.field] = f;
}

const pick = (name: string): FieldConfig => {
  const f = POOL[name];
  if (!f) throw new Error(`profile-sections: unknown field "${name}"`);
  return f;
};

const optional = (f: FieldConfig): FieldConfig => ({ ...f, optional: true });

// Fields the gate never collects, so they have no config of their own.
const PREFERRED_NAME: FieldConfig = {
  field: "preferred_name",
  label: "Preferred Name",
  type: "text",
  placeholder: "What you'd like to be called",
  optional: true,
};

const ADDRESS_LINE_2: FieldConfig = {
  field: "address_line_2",
  label: "Address Line 2",
  type: "text",
  placeholder: "Apartment, unit, etc. (optional)",
  optional: true,
};

export type ProfileSectionDef = {
  id: string;
  title: string;
  description?: string;
  fields: FieldConfig[];
};

export const PROFILE_SECTIONS: ProfileSectionDef[] = [
  {
    id: "personal",
    title: "Personal",
    fields: [
      pick("first_name"),
      pick("last_name"),
      PREFERRED_NAME,
      pick("date_of_birth"),
      pick("gender"),
      pick("marital_status"),
      pick("nationality"),
      pick("department"),
    ],
  },
  {
    id: "contact",
    title: "Contact",
    // Email is auth-managed (changed via account settings), rendered as a
    // read-only row by the page — only phone is editable here.
    fields: [pick("phone")],
  },
  {
    id: "address",
    title: "Address",
    fields: [
      pick("address_line_1"),
      ADDRESS_LINE_2,
      pick("city"),
      pick("province"),
      pick("postal_code"),
      pick("country"),
    ],
  },
  {
    id: "emergency",
    title: "Emergency Contact",
    fields: [
      pick("emergency_contact_name"),
      pick("emergency_contact_phone"),
      pick("emergency_contact_relationship"),
    ],
  },
  {
    id: "insurance",
    title: "Health Insurance",
    description:
      "We ask you to confirm this is current every 6 months — saving here counts as confirming it.",
    // Kept required: the update API rejects an empty/“none” provider
    // (mirroring the gate) and re-stamps the confirmation on save.
    fields: [
      pick("health_insurance_provider"),
      pick("health_insurance_policy_number"),
    ],
  },
  {
    id: "international",
    title: "Passport & Visa",
    description:
      "For international staff. Leave blank if you're a South African citizen.",
    fields: [
      optional(pick("passport_country")),
      optional(pick("passport_number")),
      optional(pick("visa_category")),
      ...VISA_LONG_TERM_FIELDS.map(optional),
    ],
  },
];
