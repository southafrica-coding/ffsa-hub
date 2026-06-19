// ────────────────────────────────────────────────────────────
// FFSA Hub — School Billing Engine (config layer)
// Itemized, per-course/tier charge configuration + program groups.
// See migration 095_school_billing_engine.sql.
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
  program_id: string;
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
// PROGRAM GROUPS  ("Programs" — the umbrella over courses)
// ────────────────────────────────────────────────────────────

export async function getProgramGroups(supabase: Client) {
  return supabase
    .from("program_groups")
    .select("*, programs(id, name, code, status)")
    .order("year", { ascending: false })
    .order("name", { ascending: true });
}

export async function getProgramGroupById(supabase: Client, id: string) {
  return supabase
    .from("program_groups")
    .select("*, programs(id, name, code, status, billing_arrival_date, billing_start_date)")
    .eq("id", id)
    .single();
}

export async function createProgramGroup(
  supabase: Client,
  data: {
    name: string;
    code: string;
    year?: number | null;
    description?: string | null;
    created_by?: string | null;
  }
) {
  return supabase.from("program_groups").insert(data).select().single();
}

export async function updateProgramGroup(
  supabase: Client,
  id: string,
  data: {
    name?: string;
    code?: string;
    year?: number | null;
    description?: string | null;
    status?: string;
  }
) {
  return supabase
    .from("program_groups")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

export async function deleteProgramGroup(supabase: Client, id: string) {
  return supabase.from("program_groups").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// COURSE BILLING SETTINGS (group assignment + anchor dates)
// "Course" === a row in the existing `programs` table.
// ────────────────────────────────────────────────────────────

export async function setCourseBilling(
  supabase: Client,
  programId: string,
  data: {
    program_group_id?: string | null;
    billing_arrival_date?: string | null;
    billing_start_date?: string | null;
  }
) {
  return supabase
    .from("programs")
    .update(data)
    .eq("id", programId)
    .select("id, name, code, program_group_id, billing_arrival_date, billing_start_date")
    .single();
}

// All courses with their billing config + a count of charge items.
export async function getCoursesWithBilling(supabase: Client) {
  return supabase
    .from("programs")
    .select(
      "id, name, code, status, program_group_id, billing_arrival_date, billing_start_date, program_groups(id, name, code, year), fee_charge_items(id)"
    )
    .order("name", { ascending: true });
}

// ────────────────────────────────────────────────────────────
// FEE CHARGE ITEMS (per course + tier)
// ────────────────────────────────────────────────────────────

export async function getChargeItemsByProgram(
  supabase: Client,
  programId: string
) {
  return supabase
    .from("fee_charge_items")
    .select("*")
    .eq("program_id", programId)
    .order("tier", { ascending: true })
    .order("sort_order", { ascending: true });
}

export async function upsertChargeItem(
  supabase: Client,
  data: ChargeItemInput
) {
  return supabase
    .from("fee_charge_items")
    .upsert(
      {
        cadence: "once",
        quantity: 1,
        active: true,
        sort_order: 0,
        ...data,
      },
      { onConflict: "program_id,tier,charge_type" }
    )
    .select()
    .single();
}

export async function deleteChargeItem(supabase: Client, id: string) {
  return supabase.from("fee_charge_items").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// ENROLLED STUDENTS (for a course) + their billing plans
// ────────────────────────────────────────────────────────────

export async function getEnrolledStudentsForCourse(
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
  programId: string
) {
  return supabase
    .from("student_billing_plans")
    .select("*, student_billing_schedule(*)")
    .eq("program_id", programId);
}

export async function getBillingPlanByEnrollment(
  supabase: Client,
  enrollmentId: string
) {
  return supabase
    .from("student_billing_plans")
    .select("*, student_billing_schedule(*)")
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();
}

export async function upsertBillingPlan(
  supabase: Client,
  data: {
    enrollment_id: string;
    user_id: string;
    program_id: string;
    program_group_id?: string | null;
    tier: Tier;
    tier_override?: boolean;
    payment_preference: "standard" | "quarter_prepay" | "full_prepay";
    xero_region?: "za" | "us";
    created_by?: string | null;
  }
) {
  return supabase
    .from("student_billing_plans")
    .upsert(data, { onConflict: "enrollment_id" })
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
