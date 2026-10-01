import type { SupabaseClient } from "@supabase/supabase-js";

/** Applications lock this long after a school's last course ends (migration 223). */
export const APPLICATION_EXPIRY_MONTHS = 6;

export type ApplicationExpiry = {
  /** Latest billing_courses.end_date for the school, or null (never expires). */
  endDate: string | null;
  /** ISO date the applications lock, or null when the school never expires. */
  expiresOn: string | null;
  expired: boolean;
  /** Whether the viewer may still see an expired school's applications. */
  canAccess: boolean;
};

/**
 * Expiry state for one school's applications, asked of the database so the
 * rule lives in one place: program_end_date / program_applications_expired /
 * can_access_expired_applications (migration 223). RLS already hides expired
 * applications from the user client; use this to explain the empty list and
 * to gate admin-client reads that bypass RLS.
 *
 * Pass the USER client — can_access_expired_applications() reads auth.uid().
 */
export async function getApplicationExpiry(
  supabase: SupabaseClient,
  programId: string
): Promise<ApplicationExpiry> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types predate migration 223
  const db = supabase as any;
  const [endRes, expiredRes, accessRes] = await Promise.all([
    db.rpc("program_end_date", { pid: programId }),
    db.rpc("program_applications_expired", { pid: programId }),
    db.rpc("can_access_expired_applications"),
  ]);

  const endDate: string | null = endRes.data ?? null;
  let expiresOn: string | null = null;
  if (endDate) {
    const d = new Date(`${endDate}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + APPLICATION_EXPIRY_MONTHS);
    expiresOn = d.toISOString().slice(0, 10);
  }

  return {
    endDate,
    expiresOn,
    expired: expiredRes.data === true,
    canAccess: accessRes.data === true,
  };
}

/** True when the viewer may read this school's applications as far as expiry is concerned. */
export async function passesApplicationExpiry(
  supabase: SupabaseClient,
  programId: string
): Promise<boolean> {
  const { expired, canAccess } = await getApplicationExpiry(supabase, programId);
  return !expired || canAccess;
}

export const APPLICATIONS_EXPIRED_MESSAGE =
  "Applications for this school have been archived. Contact the Training team for access.";

/**
 * Can the viewer read this application at all? Asks the USER client, so RLS
 * decides — school scope, applicant self, assigned staff and the expiry lock.
 * Use it to gate admin-client routes that act on a single application.
 */
export async function userCanReadApplication(
  supabase: SupabaseClient,
  applicationId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("application_responses")
    .select("id")
    .eq("id", applicationId)
    .maybeSingle();
  return !!data;
}
