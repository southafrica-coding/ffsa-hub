// Prayer Room — approval pipeline: apply → assign evaluator → evaluate → decide.
//
// Reads that show applicant/evaluator names use the ADMIN client. The privileged
// "decide → approve" path (create member + copy skills) also uses the ADMIN
// client AFTER the route authorizes the caller (assigned evaluator or staff).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const NAME_FIELDS = "id, first_name, last_name, preferred_name";

const APPLICATION_SELECT = `
  *,
  applicant:applicant_id(${NAME_FIELDS}),
  evaluator:evaluator_id(${NAME_FIELDS}),
  decider:decided_by(${NAME_FIELDS}),
  skills:prayer_room_application_skills(label:label_id(id, name, category)),
  seats:prayer_room_application_seats(seat_type_id, previously_evaluated),
  evaluations:prayer_room_evaluations(id, notes, met_at, created_at, evaluator_id)
`;

// ────────────────────────────────────────────────────────────
// APPLY
// ────────────────────────────────────────────────────────────

export async function createApplication(
  supabase: Client,
  data: {
    applicant_id: string;
    background?: string | null;
    /** Seats the person says they do, with their own claim about prior evaluation. */
    seats: { seat_type_id: string; previously_evaluated: boolean }[];
  }
) {
  const { data: app, error } = await supabase
    .from("prayer_room_applications")
    .insert({ applicant_id: data.applicant_id, background: data.background ?? null })
    .select()
    .single();

  if (error || !app) return { data: app, error };

  // Seats, not labels (migration 181). A label could never answer "has this
  // person been evaluated for drums" — it is a Hub-wide taxonomy, not a seat.
  if (data.seats.length > 0) {
    const rows = data.seats.map((s) => ({
      application_id: app.id,
      seat_type_id: s.seat_type_id,
      previously_evaluated: s.previously_evaluated,
    }));
    const { error: seatErr } = await supabase.from("prayer_room_application_seats").insert(rows);
    if (seatErr) return { data: app, error: seatErr };
  }

  return { data: app, error: null };
}

export async function getApplications(
  supabase: Client,
  options?: { status?: string; evaluatorId?: string; applicantId?: string }
) {
  let query = supabase
    .from("prayer_room_applications")
    .select(APPLICATION_SELECT)
    .order("created_at", { ascending: false });

  if (options?.status) query = query.eq("status", options.status);
  if (options?.evaluatorId) query = query.eq("evaluator_id", options.evaluatorId);
  if (options?.applicantId) query = query.eq("applicant_id", options.applicantId);

  return query;
}

export async function getApplicationById(supabase: Client, id: string) {
  return supabase.from("prayer_room_applications").select(APPLICATION_SELECT).eq("id", id).single();
}

/** Latest application for a user — powers the applicant's status view. */
export async function getMyLatestApplication(supabase: Client, userId: string) {
  return supabase
    .from("prayer_room_applications")
    .select(`*, skills:prayer_room_application_skills(label:label_id(id, name)), seats:prayer_room_application_seats(seat_type_id, previously_evaluated)`)
    .eq("applicant_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

// ────────────────────────────────────────────────────────────
// ASSIGN → EVALUATE → DECIDE
// ────────────────────────────────────────────────────────────

/** Coordinator assigns the application to an evaluator. Applicants cannot do this. */
export async function assignEvaluator(
  supabase: Client,
  id: string,
  data: { evaluator_id: string; assigned_by: string }
) {
  return supabase
    .from("prayer_room_applications")
    .update({
      status: "assigned",
      evaluator_id: data.evaluator_id,
      assigned_by: data.assigned_by,
      assigned_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
}

/** Assigned evaluator records the meeting notes and advances to "evaluated". */
export async function recordEvaluation(
  supabase: Client,
  data: { application_id: string; evaluator_id: string; notes?: string | null; met_at?: string | null }
) {
  const { error: evalErr } = await supabase.from("prayer_room_evaluations").insert({
    application_id: data.application_id,
    evaluator_id: data.evaluator_id,
    notes: data.notes ?? null,
    met_at: data.met_at ?? new Date().toISOString(),
  });
  if (evalErr) return { data: null, error: evalErr };

  return supabase
    .from("prayer_room_applications")
    .update({ status: "evaluated" })
    .eq("id", data.application_id)
    .select()
    .single();
}

/**
 * Decide — TWO outcomes only. Uses the ADMIN client (route authorizes first).
 * Approve → upsert an active member + copy the desired skills onto the user.
 * Deny → terminal (the person may re-apply later).
 */
export async function decideApplication(
  adminClient: Client,
  data: { id: string; approve: boolean; decided_by: string; decision_note?: string | null }
) {
  // load applicant + desired skills
  const { data: app, error: loadErr } = await adminClient
    .from("prayer_room_applications")
    .select(
      `applicant_id,
       skills:prayer_room_application_skills(label_id),
       seats:prayer_room_application_seats(seat_type_id)`
    )
    .eq("id", data.id)
    .single();
  if (loadErr || !app) return { data: null, error: loadErr };

  const { data: updated, error } = await adminClient
    .from("prayer_room_applications")
    .update({
      status: data.approve ? "approved" : "denied",
      decided_by: data.decided_by,
      decided_at: new Date().toISOString(),
      decision_note: data.decision_note ?? null,
    })
    .eq("id", data.id)
    .select()
    .single();
  if (error) return { data: null, error };

  if (data.approve) {
    // become / reactivate an approved member
    await adminClient
      .from("prayer_room_members")
      .upsert(
        { user_id: app.applicant_id, status: "active", approved_by: data.decided_by },
        { onConflict: "user_id" }
      );

    // Sign off the seats they were approved for. THIS is what puts someone in
    // the catalogue — approval used to make you a member and copy some labels,
    // and never touched prayer_room_qualifications, so "approved" and "signed
    // off for a seat" were unrelated facts and nothing enforced the difference.
    const seatIds: string[] = (app.seats ?? []).map((s: { seat_type_id: string }) => s.seat_type_id);
    if (seatIds.length > 0) {
      await adminClient.from("prayer_room_qualifications").upsert(
        seatIds.map((seat_type_id) => ({
          user_id: app.applicant_id,
          seat_type_id,
          state: "signed_off",
          updated_by: data.decided_by,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,seat_type_id" }
      );
    }

    // copy desired skills onto the user (ignore ones they already have)
    const labelIds: string[] = (app.skills ?? []).map((s: { label_id: string }) => s.label_id);
    if (labelIds.length > 0) {
      const rows = labelIds.map((label_id) => ({
        user_id: app.applicant_id,
        label_id,
        assigned_by: data.decided_by,
      }));
      await adminClient
        .from("user_label_assignments")
        .upsert(rows, { onConflict: "user_id,label_id", ignoreDuplicates: true });
    }
  }

  return { data: updated, error: null };
}
