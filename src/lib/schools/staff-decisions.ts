import { LEADERSHIP_TRACK_CODES, isLeadershipTrackCode } from "@/lib/schools/leadership-track";

// Leadership Track "accepted as staff?" decisions (migration 247).
//
// Every read here uses the service-role client, so callers MUST check
// isLeadershipTeam() first. That is deliberate: the Leadership Team keeps
// this access after the school ends or is archived, which the programs /
// enrollments RLS would not allow.

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Who appears on the list: anyone who actually arrived. Graduated is
// included because statuses move arrived → graduated at the end of the
// school, which is exactly when the decision is made.
export const DECIDABLE_STATUSES = ["arrived", "graduated"] as const;

export type StaffDecision = {
  accepted: boolean;
  note: string | null;
  decidedAt: string;
  decidedByName: string | null;
};

export type StaffDecisionRow = {
  enrollmentId: string;
  userId: string | null;
  name: string;
  email: string | null;
  status: string;
  isStaff: boolean;
  department: string | null;
  decision: StaffDecision | null;
};

export function canBeDecided(enrollment: {
  status: string | null;
  removed_at: string | null;
}): boolean {
  return (
    !enrollment.removed_at &&
    (DECIDABLE_STATUSES as readonly string[]).includes(enrollment.status ?? "")
  );
}

function personName(u: { first_name?: string | null; last_name?: string | null } | null) {
  return [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim();
}

export async function getLeadershipTrackProgram(admin: Client, programId: string) {
  const { data } = await admin
    .from("programs")
    .select("id, name, code, status")
    .eq("id", programId)
    .maybeSingle();
  return data && isLeadershipTrackCode(data.code)
    ? (data as { id: string; name: string; code: string; status: string })
    : null;
}

export async function listLeadershipTrackPrograms(admin: Client) {
  const { data } = await admin
    .from("programs")
    .select("id, name, code, status")
    .in("code", [...LEADERSHIP_TRACK_CODES]);
  return (data ?? []) as Array<{ id: string; name: string; code: string; status: string }>;
}

export async function loadStaffDecisionRows(
  admin: Client,
  programId: string
): Promise<StaffDecisionRow[]> {
  const [{ data: enrollments }, { data: decisions }] = await Promise.all([
    admin
      .from("enrollments")
      .select("id, user_id, status, removed_at, person_email, person_info")
      .eq("program_id", programId),
    admin
      .from("staff_acceptance_decisions")
      .select("enrollment_id, accepted, note, decided_at, decided_by")
      .eq("program_id", programId),
  ]);

  const decisionByEnrollment = new Map<string, Record<string, unknown>>();
  for (const d of (decisions ?? []) as Array<Record<string, unknown>>) {
    decisionByEnrollment.set(String(d.enrollment_id), d);
  }

  const listed = ((enrollments ?? []) as Array<Record<string, unknown>>).filter(
    (e) =>
      canBeDecided(e as { status: string | null; removed_at: string | null }) ||
      decisionByEnrollment.has(String(e.id))
  );

  // Identity only (name/email/department) — never the sensitive PII columns.
  const userIds = new Set<string>();
  for (const e of listed) if (typeof e.user_id === "string") userIds.add(e.user_id);
  for (const d of decisionByEnrollment.values())
    if (typeof d.decided_by === "string") userIds.add(d.decided_by);

  const [{ data: users }, { data: staffRows }] = await Promise.all([
    userIds.size
      ? admin
          .from("users")
          .select("id, first_name, last_name, email, department")
          .in("id", Array.from(userIds))
      : Promise.resolve({ data: [] }),
    userIds.size
      ? admin
          .from("user_roles")
          .select("user_id, roles!inner(name)")
          .eq("roles.name", "staff")
          .in("user_id", Array.from(userIds))
      : Promise.resolve({ data: [] }),
  ]);
  const userById = new Map<string, Record<string, string | null>>();
  for (const u of (users ?? []) as Array<Record<string, string | null>>) {
    userById.set(String(u.id), u);
  }
  const staffIds = new Set(
    ((staffRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
  );

  const rows = listed.map((e): StaffDecisionRow => {
    const userId = typeof e.user_id === "string" ? e.user_id : null;
    const u = userId ? userById.get(userId) ?? null : null;
    const info = (e.person_info ?? {}) as Record<string, string | null>;
    const d = decisionByEnrollment.get(String(e.id));
    const decider = d && typeof d.decided_by === "string" ? userById.get(d.decided_by) : null;
    return {
      enrollmentId: String(e.id),
      userId,
      name: personName(u) || personName(info) || "Unknown",
      email: (u?.email ?? (e.person_email as string | null)) || null,
      status: String(e.status ?? ""),
      isStaff: !!userId && staffIds.has(userId),
      department: u?.department ?? null,
      decision: d
        ? {
            accepted: d.accepted === true,
            note: (d.note as string | null) ?? null,
            decidedAt: String(d.decided_at),
            decidedByName: decider ? personName(decider) || null : null,
          }
        : null,
    };
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
