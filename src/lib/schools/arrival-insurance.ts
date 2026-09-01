// ────────────────────────────────────────────────────────────
// ARRIVAL-DAY: profile + health-insurance summary per student
// ────────────────────────────────────────────────────────────
// The arrival roster needs, for each enrolled student:
//   - whether they've even started a profile yet ("No profile yet"),
//   - if not, how far through they are and what's missing,
//   - the validity of the health-insurance policy they entered.
//
// Insurance and the profile-completeness fields live on public.users, which
// RLS nulls for non-admin program leaders. So this MUST be called with the
// service-role admin client, server-side only. We derive a COMPACT summary
// here and return only that — the raw PII on `users` (DOB, address, passport,
// emergency contacts) never leaves the server.
//
// Reuses deriveUserLifecycle (the same logic the profile-completion gate and
// the admin Users table use) and getInsuranceStatus, so the badges never drift
// from what actually blocks a student entering the Hub.

import {
  deriveUserLifecycle,
  groupMissingFields,
  type UserLifecycleStage,
} from "@/lib/users/lifecycle";
import { type InsuranceStatus } from "@/lib/users/profile-fields";
import { getAuthSignIns } from "@/lib/users/auth-signins";

export type ArrivalInsuranceInfo = {
  // Profile onboarding stage. "invited" == accepted but hasn't signed in /
  // filled anything in yet — i.e. "No profile yet".
  profileStage: UserLifecycleStage;
  profileLabel: string;
  completedRequired: number;
  totalRequired: number;
  // Human-readable missing sections, e.g. ["Personal (3)", "Health insurance (2)"].
  missingSections: string[];
  // The same grouping, but naming each missing field so the arrival-day helper
  // can read out exactly what to ask the student for. LABELS ONLY — never the
  // stored values, so this stays as PII-safe as the section counts above.
  missingGroups: { section: string; fields: string[] }[];
  // Auto-computed validity of the entered policy (ok / expiring / expired / missing).
  insurance: InsuranceStatus;
  provider: string | null;
  policyNumber: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the `Client = any` convention in services
type AdminClient = any;

/**
 * Build the arrival summary for a set of enrolled user ids. Returns a map
 * keyed by user id; ids with no matching users row are simply absent.
 */
export async function getArrivalInsuranceInfo(
  admin: AdminClient,
  userIds: Array<string | null | undefined>
): Promise<Record<string, ArrivalInsuranceInfo>> {
  const out: Record<string, ArrivalInsuranceInfo> = {};
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => typeof id === "string"))
  );
  if (ids.length === 0) return out;

  const { data: users } = await admin.from("users").select("*").in("id", ids);
  if (!users || users.length === 0) return out;

  // Ground-truth sign-in data — the users.last_sign_in_at mirror is unmaintained
  // (see auth-signins.ts). Falls back to the (usually null) column if the auth
  // lookup fails, which at worst reads a signed-in-but-empty profile as "No
  // profile yet" — still a flag, never a false "Complete".
  let signIns: Map<string, string | null>;
  try {
    signIns = await getAuthSignIns();
  } catch {
    signIns = new Map();
  }

  for (const u of users) {
    const row = {
      ...u,
      last_sign_in_at: signIns.get(u.id) ?? u.last_sign_in_at ?? null,
    };
    const lc = deriveUserLifecycle(row);
    const groups = groupMissingFields(lc.missingFields);
    out[u.id] = {
      profileStage: lc.stage,
      profileLabel: lc.label,
      completedRequired: lc.completedRequired,
      totalRequired: lc.totalRequired,
      missingSections: groups.map((g) => `${g.section} (${g.fields.length})`),
      missingGroups: groups.map((g) => ({
        section: g.section,
        fields: g.fields.map((f) => f.label),
      })),
      insurance: lc.insurance,
      provider: (u.health_insurance_provider as string | null) ?? null,
      policyNumber: (u.health_insurance_policy_number as string | null) ?? null,
    };
  }

  return out;
}
