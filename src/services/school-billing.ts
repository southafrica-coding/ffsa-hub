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

export async function getProgramsForBilling(supabase: Client) {
  return supabase
    .from("programs")
    .select("id, name, code, status, billing_courses(id)")
    .order("name", { ascending: true });
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
