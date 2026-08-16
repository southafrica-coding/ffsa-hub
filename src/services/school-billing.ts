// ────────────────────────────────────────────────────────────
// FFSA Hub — School Billing Engine (config layer)
// Program (umbrella) → billing_courses → fee_charge_items / plans.
// See migrations 095 + 098.
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type Tier = "A" | "B" | "C";

export type ChargeType =
  | "deposit"
  | "monthly_tuition"
  | "outreach"
  | "quarter_first"
  | "quarter_final";

export type Cadence = "once" | "monthly";

export type DueAnchor =
  | "acceptance"
  | "month_day"
  | "fixed_date"
  | "relative_to_arrival";

export type GenerationRule =
  | "immediate"
  | "preceding_month_15th"
  | "fixed_date"
  | "days_before_due";

export interface ChargeItemInput {
  course_id: string;
  tier: Tier;
  charge_type: ChargeType;
  label: string;
  amount_zar: number;
  xero_item_code?: string | null;
  cadence?: Cadence;
  quantity?: number;
  due_anchor?: DueAnchor;
  due_day?: number | null;
  first_due_month?: number | null;
  first_due_year?: number | null;
  fixed_due_date?: string | null;
  arrival_offset_days?: number | null;
  generation_rule?: GenerationRule;
  generation_fixed_date?: string | null;
  generation_lead_days?: number | null;
  sort_order?: number;
  active?: boolean;
  notes?: string | null;
}

// ────────────────────────────────────────────────────────────
// PROGRAMS (umbrella — the existing `programs` table)
// ────────────────────────────────────────────────────────────

/**
 * Schools for the finance surfaces.
 *
 * `billing_mode` comes back with every row so no screen can forget it. A school
 * on `external` is billed outside the Hub entirely — it must never appear in an
 * invoice run, the debtors report or a reminder queue, and its fee surfaces say
 * so plainly rather than showing zeros, which read as "nothing owed".
 *
 * Selected defensively: migration 172 may not be applied yet, in which case the
 * columns are absent and every school reads as external — the safe direction.
 */
export async function getProgramsForBilling(supabase: Client) {
  const withMode = await supabase
    .from("programs")
    .select(
      "id, name, code, status, billing_mode, schedule_start_date, billing_emails_enabled, billing_courses(id)"
    )
    .order("name", { ascending: true });

  if (!withMode.error) return withMode;

  return supabase
    .from("programs")
    .select("id, name, code, status, billing_courses(id)")
    .order("name", { ascending: true });
}

/** Schools the Hub actually bills. Everything that generates money uses this. */
export async function getHubBilledPrograms(supabase: Client) {
  return supabase
    .from("programs")
    .select("id, name, code, status, schedule_start_date, billing_emails_enabled")
    .eq("billing_mode", "hub_scheduled")
    .order("name", { ascending: true });
}

/**
 * Guard for anything that schedules or generates. Returns a reason string when
 * the school is not billable, null when it is.
 *
 * The database refuses these writes too (trigger in 172); this exists so a
 * screen can explain why rather than surfacing a raw constraint error.
 */
export async function billingBlockedReason(
  supabase: Client,
  programId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("programs")
    .select("name, billing_mode")
    .eq("id", programId)
    .maybeSingle();

  // Columns absent (172 unapplied) — treat as not billable rather than
  // assuming permission we cannot verify.
  if (error) return "Hub billing is not switched on for this school yet.";
  if (!data) return "That school could not be found.";
  if ((data as { billing_mode?: string }).billing_mode !== "hub_scheduled") {
    return `${(data as { name?: string }).name ?? "This school"} is billed outside the Hub. Switch it to Hub scheduling before adding charges.`;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// BILLING COURSES (chronological courses under a Program)
// ────────────────────────────────────────────────────────────

export async function getBillingCoursesByProgram(
  supabase: Client,
  programId: string
) {
  return supabase
    .from("billing_courses")
    .select("*, fee_charge_items(id)")
    .eq("program_id", programId)
    .order("sequence", { ascending: true })
    .order("name", { ascending: true });
}

export async function getBillingCourseById(supabase: Client, id: string) {
  return supabase.from("billing_courses").select("*").eq("id", id).single();
}

export async function createBillingCourse(
  supabase: Client,
  data: {
    program_id: string;
    code: string;
    name: string;
    scope?: "full_program" | "segment";
    sequence?: number;
    start_date?: string | null;
    end_date?: string | null;
    arrival_date?: string | null;
    enroll_lead_days?: number;
    created_by?: string | null;
  }
) {
  return supabase.from("billing_courses").insert(data).select().single();
}

export async function updateBillingCourse(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("billing_courses")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

export async function deleteBillingCourse(supabase: Client, id: string) {
  return supabase.from("billing_courses").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// FEE CHARGE ITEMS (per course + tier)
// ────────────────────────────────────────────────────────────

export async function getChargeItemsByCourse(
  supabase: Client,
  courseId: string
) {
  return supabase
    .from("fee_charge_items")
    .select("*")
    .eq("course_id", courseId)
    .order("tier", { ascending: true })
    .order("sort_order", { ascending: true });
}

export async function getChargeItemsByProgram(
  supabase: Client,
  programId: string
) {
  // All charge items for every course under a program (for overview).
  return supabase
    .from("fee_charge_items")
    .select("*, billing_courses!inner(program_id)")
    .eq("billing_courses.program_id", programId);
}

export async function upsertChargeItem(supabase: Client, data: ChargeItemInput) {
  return supabase
    .from("fee_charge_items")
    .upsert(
      { cadence: "once", quantity: 1, active: true, sort_order: 0, ...data },
      { onConflict: "course_id,tier,charge_type" }
    )
    .select()
    .single();
}

export async function deleteChargeItem(supabase: Client, id: string) {
  return supabase.from("fee_charge_items").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// PROGRAM-LEVEL CHARGE ITEMS (the whole-program structure)
// ────────────────────────────────────────────────────────────

export type ProgramChargeItemInput = Omit<ChargeItemInput, "course_id"> & {
  program_id: string;
};

export async function getProgramChargeItems(
  supabase: Client,
  programId: string
) {
  return supabase
    .from("program_charge_items")
    .select("*")
    .eq("program_id", programId)
    .order("tier", { ascending: true })
    .order("sort_order", { ascending: true });
}

export async function upsertProgramChargeItem(
  supabase: Client,
  data: ProgramChargeItemInput
) {
  return supabase
    .from("program_charge_items")
    .upsert(
      { cadence: "once", quantity: 1, active: true, sort_order: 0, ...data },
      { onConflict: "program_id,tier,charge_type" }
    )
    .select()
    .single();
}

export async function deleteProgramChargeItem(supabase: Client, id: string) {
  return supabase.from("program_charge_items").delete().eq("id", id);
}

// Whole-program billing plan = one plan per enrolment with course_id NULL.
export async function setWholeProgramPlan(
  supabase: Client,
  data: {
    enrollment_id: string;
    user_id: string;
    program_id: string;
    tier: Tier;
    tier_override?: boolean;
    payment_preference: "standard" | "quarter_prepay" | "full_prepay";
    xero_region?: "za" | "us";
    created_by?: string | null;
  }
) {
  await supabase
    .from("student_billing_plans")
    .delete()
    .eq("enrollment_id", data.enrollment_id)
    .is("course_id", null);
  return supabase
    .from("student_billing_plans")
    .insert({ ...data, course_id: null })
    .select()
    .single();
}

export async function deleteWholeProgramPlan(
  supabase: Client,
  enrollmentId: string
) {
  return supabase
    .from("student_billing_plans")
    .delete()
    .eq("enrollment_id", enrollmentId)
    .is("course_id", null);
}

export async function deleteAllCoursePlans(
  supabase: Client,
  enrollmentId: string
) {
  return supabase
    .from("student_billing_plans")
    .delete()
    .eq("enrollment_id", enrollmentId)
    .not("course_id", "is", null);
}

// ────────────────────────────────────────────────────────────
// ENROLLED STUDENTS (program-level enrolment) + billing plans
// ────────────────────────────────────────────────────────────

export async function getEnrolledStudentsForProgram(
  supabase: Client,
  programId: string
) {
  return supabase
    .from("enrollments")
    .select(
      "id, user_id, status, enrolled_at, users!enrollments_user_id_fkey(id, first_name, last_name, preferred_name, email, nationality)"
    )
    .eq("program_id", programId)
    .in("status", ["active", "on_hold"])
    .order("enrolled_at", { ascending: false });
}

export async function getBillingPlansForCourse(
  supabase: Client,
  courseId: string
) {
  return supabase
    .from("student_billing_plans")
    .select("*, student_billing_schedule(*)")
    .eq("course_id", courseId);
}

export async function upsertBillingPlan(
  supabase: Client,
  data: {
    enrollment_id: string;
    user_id: string;
    program_id: string;
    course_id: string;
    tier: Tier;
    tier_override?: boolean;
    payment_preference: "standard" | "quarter_prepay" | "full_prepay";
    xero_region?: "za" | "us";
    created_by?: string | null;
  }
) {
  return supabase
    .from("student_billing_plans")
    .upsert(data, { onConflict: "enrollment_id,course_id" })
    .select()
    .single();
}

// Replace all NOT-yet-generated ('scheduled') rows for a plan with a fresh set.
// Rows already pushed to Xero (generated/sent/paid) are left untouched.
export async function replaceScheduledRows(
  supabase: Client,
  planId: string,
  rows: Array<Record<string, unknown>>
) {
  const del = await supabase
    .from("student_billing_schedule")
    .delete()
    .eq("plan_id", planId)
    .eq("status", "scheduled");
  if (del.error) return del;

  if (rows.length === 0) return { data: [], error: null };

  return supabase
    .from("student_billing_schedule")
    .insert(rows.map((r) => ({ ...r, plan_id: planId })))
    .select();
}

export async function getBillingPlansForEnrollment(
  supabase: Client,
  enrollmentId: string
) {
  return supabase
    .from("student_billing_plans")
    .select(
      "*, billing_courses(id, code, name, sequence), student_billing_schedule(*)"
    )
    .eq("enrollment_id", enrollmentId);
}

export async function deleteBillingPlanForEnrollmentCourse(
  supabase: Client,
  enrollmentId: string,
  courseId: string
) {
  return supabase
    .from("student_billing_plans")
    .delete()
    .eq("enrollment_id", enrollmentId)
    .eq("course_id", courseId);
}

export async function getCountryTierMap(supabase: Client) {
  const { data } = await supabase
    .from("country_tiers")
    .select("country_name, tier");
  const map: Record<string, Tier> = {};
  for (const row of data ?? []) {
    map[row.country_name.toLowerCase()] = row.tier as Tier;
  }
  return map;
}
