// ────────────────────────────────────────────────────────────
// FFSA Hub — Billing plan commit logic
// ────────────────────────────────────────────────────────────
// Extracted from the finance "student-program-billing" route so the same
// whole-program / per-segment commit logic can also run automatically at
// application acceptance (src/services/billing-generation.ts), driven by
// the student's enrollment_segments track-of-record (migration 221)
// instead of always defaulting to whole-program.
// ────────────────────────────────────────────────────────────

import {
  setWholeProgramPlan,
  deleteWholeProgramPlan,
  deleteAllCoursePlans,
  upsertBillingPlan,
  deleteBillingPlanForEnrollmentCourse,
  replaceScheduledRows,
  type Tier,
} from "@/services/school-billing";
import {
  buildSchedule,
  scheduleTotal,
  type BuilderChargeItem,
} from "@/lib/finance/schedule-builder";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type BillingPreference = "standard" | "quarter_prepay" | "full_prepay";

interface CommitParams {
  enrollmentId: string;
  userId: string;
  programId: string;
  tier: Tier;
  tierOverride?: boolean;
  preference: BillingPreference;
  region?: "za" | "us";
  createdBy: string | null;
  acceptanceDate: string;
}

export interface CommitResult {
  ok: boolean;
  grandTotal: number;
  warnings: string[];
  error?: string;
}

/**
 * Keeps enrollment_segments (the track-of-record, migration 221) in step
 * with whatever billing plan was just committed — `courseIds: null` means
 * whole-program (one row, billing_course_id NULL), otherwise one row per
 * segment. Best-effort: a sync failure here must not undo the billing plan
 * that already committed successfully.
 */
async function syncEnrollmentSegments(
  supabase: Client,
  enrollmentId: string,
  courseIds: string[] | null,
  createdBy: string | null
) {
  try {
    await supabase.from("enrollment_segments").delete().eq("enrollment_id", enrollmentId);
    const rows =
      courseIds === null
        ? [{ enrollment_id: enrollmentId, billing_course_id: null, created_by: createdBy }]
        : courseIds.map((id) => ({
            enrollment_id: enrollmentId,
            billing_course_id: id,
            created_by: createdBy,
          }));
    // Nothing selected (e.g. every segment was unchecked) — leave no track
    // row rather than sending an empty insert.
    if (rows.length === 0) return;
    await supabase.from("enrollment_segments").insert(rows);
  } catch (err) {
    console.error("[syncEnrollmentSegments] failed", err);
  }
}

/** Bills the program-level whole-program structure and trims any per-segment plans. */
export async function commitWholeProgramPlan(
  supabase: Client,
  params: CommitParams
): Promise<CommitResult> {
  const { data: items } = await supabase
    .from("program_charge_items")
    .select("*")
    .eq("program_id", params.programId)
    .eq("tier", params.tier)
    .eq("active", true);

  const { rows, warnings } = buildSchedule((items ?? []) as BuilderChargeItem[], {
    acceptanceDate: params.acceptanceDate,
    arrivalDate: null,
    groupYear: null,
    paymentPreference: params.preference,
  });
  const grandTotal = scheduleTotal(rows);

  const { data: plan, error: planErr } = await setWholeProgramPlan(supabase, {
    enrollment_id: params.enrollmentId,
    user_id: params.userId,
    program_id: params.programId,
    tier: params.tier,
    tier_override: !!params.tierOverride,
    payment_preference: params.preference,
    xero_region: params.region,
    created_by: params.createdBy,
  });
  if (planErr || !plan) {
    return { ok: false, grandTotal: 0, warnings, error: planErr?.message ?? "Failed to save plan" };
  }

  const { error: rowsErr } = await replaceScheduledRows(
    supabase,
    plan.id,
    rows.map((r) => ({
      // Whole-program charges live in program_charge_items, but this column's
      // foreign key points at fee_charge_items (course charges, migration 095).
      // Writing a program charge id here broke every insert, so whole-program
      // students got a plan with NO charges and no deposit invoice. Leave it
      // empty: nothing reads it for whole-program rows.
      charge_item_id: null,
      charge_type: r.charge_type,
      label: r.label,
      sequence: r.sequence,
      amount_zar: r.amount_zar,
      xero_item_code: r.xero_item_code,
        xero_tracking_option: r.xero_tracking_option,
      scheduled_generation_date: r.scheduled_generation_date,
      due_date: r.due_date,
      combined_group_key: r.combined_group_key,
      // The builder owns this — hardcoding it discarded the generation guard.
      status: r.status,
    }))
  );
  if (rowsErr) return { ok: false, grandTotal: 0, warnings, error: rowsErr.message };

  // Trim any individual-segment plans (student is now whole-program).
  await deleteAllCoursePlans(supabase, params.enrollmentId);
  await syncEnrollmentSegments(supabase, params.enrollmentId, null, params.createdBy);

  return { ok: true, grandTotal, warnings };
}

/**
 * Bills exactly the given billing_courses (segments) and trims everything
 * else — any segment plan not in `courseIds`, and the whole-program plan.
 */
export async function commitSegmentPlans(
  supabase: Client,
  params: CommitParams & { courseIds: string[] }
): Promise<CommitResult> {
  const { data: courses } = await supabase
    .from("billing_courses")
    .select("id, code, name, sequence, arrival_date, start_date")
    .eq("program_id", params.programId)
    .order("sequence", { ascending: true });

  const allCourses = courses ?? [];
  const selectedSet = new Set(params.courseIds);
  const warnings: string[] = [];
  let grandTotal = 0;

  for (const course of allCourses) {
    if (!selectedSet.has(course.id)) {
      await deleteBillingPlanForEnrollmentCourse(supabase, params.enrollmentId, course.id);
      continue;
    }

    const { data: items } = await supabase
      .from("fee_charge_items")
      .select("*")
      .eq("course_id", course.id)
      .eq("tier", params.tier)
      .eq("active", true);
    const groupYear = course.start_date
      ? Number(String(course.start_date).split("-")[0])
      : null;
    const built = buildSchedule((items ?? []) as BuilderChargeItem[], {
      acceptanceDate: params.acceptanceDate,
      arrivalDate: course.arrival_date ?? null,
      groupYear,
      paymentPreference: params.preference,
    });
    built.warnings.forEach((w) => warnings.push(`${course.name}: ${w}`));
    grandTotal += scheduleTotal(built.rows);

    const { data: plan, error: planErr } = await upsertBillingPlan(supabase, {
      enrollment_id: params.enrollmentId,
      user_id: params.userId,
      program_id: params.programId,
      course_id: course.id,
      tier: params.tier,
      tier_override: !!params.tierOverride,
      payment_preference: params.preference,
      xero_region: params.region,
      created_by: params.createdBy,
    });
    if (planErr || !plan) {
      return { ok: false, grandTotal: 0, warnings, error: planErr?.message ?? "Failed to save plan" };
    }
    const { error: rowsErr } = await replaceScheduledRows(
      supabase,
      plan.id,
      built.rows.map((r) => ({
        charge_item_id: r.charge_item_id ?? null,
        charge_type: r.charge_type,
        label: r.label,
        sequence: r.sequence,
        amount_zar: r.amount_zar,
        xero_item_code: r.xero_item_code,
        xero_tracking_option: r.xero_tracking_option,
        scheduled_generation_date: r.scheduled_generation_date,
        due_date: r.due_date,
        combined_group_key: r.combined_group_key,
        // The builder owns this — hardcoding it discarded the generation guard.
        status: r.status,
      }))
    );
    if (rowsErr) return { ok: false, grandTotal: 0, warnings, error: rowsErr.message };
  }

  // Trim the whole-program plan (student is now on individual segments).
  await deleteWholeProgramPlan(supabase, params.enrollmentId);
  await syncEnrollmentSegments(supabase, params.enrollmentId, params.courseIds, params.createdBy);

  return { ok: true, grandTotal, warnings };
}
