import {
  getMissingProfileFields,
  getInsuranceStatus,
  type FieldConfig,
  type InsuranceStatus,
  REQUIRED_PROFILE_FIELDS,
} from "./profile-fields";

export type UserLifecycleStage =
  | "invited"
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
  status?: string | null;
  last_sign_in_at?: string | null;
  [field: string]: unknown;
};

const STAGE_LABELS: Record<UserLifecycleStage, { label: string; description: string }> = {
  invited: {
    label: "Invited",
    description: "Invite sent — hasn't accepted yet",
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
  const missingFields = getMissingProfileFields(user as Record<string, unknown>);
  const totalRequired = REQUIRED_PROFILE_FIELDS.length;
  const completedRequired = totalRequired - missingFields.length;
  const insurance = getInsuranceStatus(user as Record<string, unknown>);

  const stage: UserLifecycleStage = computeStage(user, missingFields.length);
  const { label, description } = STAGE_LABELS[stage];

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
  if (!user.accepted_at && !user.last_sign_in_at) return "invited";

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
