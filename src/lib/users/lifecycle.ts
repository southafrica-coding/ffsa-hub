import { formatInviteDate } from "@/lib/schools/setup-invite-schedule";
import {
  getMissingProfileFields,
  getMissingPassportFields,
  getMissingVisaFields,
  getInsuranceStatus,
  type FieldConfig,
  type InsuranceStatus,
  REQUIRED_PROFILE_FIELDS,
  PASSPORT_FIELDS,
  VISA_BASE_FIELDS,
  VISA_LONG_TERM_FIELDS,
} from "./profile-fields";

export type UserLifecycleStage =
  | "invited"
  | "invite_scheduled"
  | "profile_incomplete"
  | "pending_approval"
  | "active"
  | "inactive";

export type LifecycleInfo = {
  stage: UserLifecycleStage;
  label: string;
  description: string;
  missingFields: FieldConfig[];
  totalRequired: number;
  completedRequired: number;
  // Health-insurance validity is orthogonal to onboarding stage: an
  // otherwise-"active" user can still have a lapsed policy, which the
  // gate treats as a hard block. Surfaced here so the admin Users table
  // can flag it.
  insurance: InsuranceStatus;
};

export type UserLifecycleInput = {
  is_active?: boolean | null;
  accepted_at?: string | null;
  invited_at?: string | null;
  setup_invite_due_on?: string | null;
  status?: string | null;
  last_sign_in_at?: string | null;
  [field: string]: unknown;
};

const STAGE_LABELS: Record<UserLifecycleStage, { label: string; description: string }> = {
  invited: {
    label: "Invited",
    description: "Invite sent — hasn't accepted yet",
  },
  invite_scheduled: {
    label: "Invite scheduled",
    description: "Accepted to a school — their setup link goes out a month before it starts",
  },
  profile_incomplete: {
    label: "Profile Incomplete",
    description: "Signed in but missing required profile info",
  },
  pending_approval: {
    label: "Pending Approval",
    description: "Profile complete — awaiting super admin approval",
  },
  active: {
    label: "Active",
    description: "Fully onboarded",
  },
  inactive: {
    label: "Inactive",
    description: "Account disabled by an admin",
  },
};

export function deriveUserLifecycle(user: UserLifecycleInput): LifecycleInfo {
  const row = user as Record<string, unknown>;

  // Everything the profile-completion gate would block on: the core required
  // fields plus passport (required for everyone) and visa (international staff
  // only). Kept in sync with getProfileBlock so the badge/lists match what
  // actually stops the user entering the Hub.
  const missingFields = [
    ...getMissingProfileFields(row),
    ...getMissingPassportFields(row),
    ...getMissingVisaFields(row),
  ];
  const totalRequired = countApplicableFields(row);
  const completedRequired = totalRequired - missingFields.length;
  const insurance = getInsuranceStatus(row);

  const stage: UserLifecycleStage = computeStage(user, missingFields.length);
  const { label } = STAGE_LABELS[stage];
  const description =
    stage === "invite_scheduled" && user.setup_invite_due_on
      ? `Accepted to a school — their setup link is emailed on ${formatInviteDate(user.setup_invite_due_on)}`
      : STAGE_LABELS[stage].description;

  return {
    stage,
    label,
    description,
    missingFields,
    totalRequired,
    completedRequired,
    insurance,
  };
}

// How many fields are actually required for THIS user — the denominator in
// the "X of Y fields" summary. Passport applies to everyone; visa only to
// international staff (and the long-term specifics only for a long-term visa).
// Mirrors the conditional getMissingVisaFields encodes so the two never drift.
function countApplicableFields(row: Record<string, unknown>): number {
  let total = REQUIRED_PROFILE_FIELDS.length + PASSPORT_FIELDS.length;
  // An open-ended medical scheme is never asked for an expiry date, so it
  // must not count towards the denominator either — otherwise these users
  // read "23 of 24 fields" forever.
  if (row.health_insurance_no_expiry === true) total -= 1;
  if (row.is_international) {
    total += VISA_BASE_FIELDS.length;
    if (row.visa_category === "long_term") {
      total += VISA_LONG_TERM_FIELDS.length;
    }
  }
  return total;
}

// Group missing fields into readable sections for the admin surfaces, keyed off
// the column-name prefix. Order is intentional (matches the onboarding form).
// Returns only non-empty groups.
export type MissingFieldGroup = { section: string; fields: FieldConfig[] };

export function groupMissingFields(fields: FieldConfig[]): MissingFieldGroup[] {
  const sectionFor = (field: string): string => {
    if (field.startsWith("address_") || field === "city" || field === "province" || field === "postal_code" || field === "country") {
      return "Address";
    }
    if (field.startsWith("emergency_contact_")) return "Emergency contact";
    if (field.startsWith("health_insurance_")) return "Health insurance";
    if (field.startsWith("passport_")) return "Passport";
    if (field.startsWith("visa_")) return "Visa";
    return "Personal";
  };

  const order = [
    "Personal",
    "Address",
    "Emergency contact",
    "Health insurance",
    "Passport",
    "Visa",
  ];
  const bySection = new Map<string, FieldConfig[]>();
  for (const f of fields) {
    const section = sectionFor(f.field);
    const bucket = bySection.get(section) ?? [];
    bucket.push(f);
    bySection.set(section, bucket);
  }
  return order
    .filter((section) => bySection.has(section))
    .map((section) => ({ section, fields: bySection.get(section)! }));
}

function computeStage(
  user: UserLifecycleInput,
  missingCount: number
): UserLifecycleStage {
  // Inactive trumps everything — an admin has actively turned this user off.
  if (user.is_active === false) return "inactive";

  // Hasn't joined yet: no acceptance recorded AND never signed in. A real
  // sign-in is itself proof of acceptance, so the caller should supply
  // last_sign_in_at from Supabase Auth (the app's accepted_at / last_sign_in_at
  // columns were historically left unset for founder/seed accounts, which made
  // active users — including super admins — wrongly read as "Invited").
  if (!user.accepted_at && !user.last_sign_in_at) {
    // Accepted applicant whose setup link is held until nearer the start
    // (migration 230) — they haven't been sent anything to accept yet.
    return user.setup_invite_due_on ? "invite_scheduled" : "invited";
  }

  // Accepted but the profile-completion-gate would still block them.
  if (missingCount > 0) return "profile_incomplete";

  // Explicit hold by a super admin (rare today, but the schema supports it).
  if (user.status === "pending_approval") return "pending_approval";

  return "active";
}

// "3 days ago", "2 hours ago", "just now" — relative time for the table.
export function formatRelativeTime(iso: string | null | undefined, nowMs?: number): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const now = nowMs ?? Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? "" : "s"} ago`;
  const diffYear = Math.round(diffDay / 365);
  return `${diffYear} year${diffYear === 1 ? "" : "s"} ago`;
}
