import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import {
  upsertBillingPlan,
  replaceScheduledRows,
  deleteBillingPlanForEnrollmentCourse,
  getCountryTierMap,
  type Tier,
} from "@/services/school-billing";
import { getXeroRegionForStudent } from "@/services/xero";
import {
  buildSchedule,
  scheduleTotal,
  type BuilderChargeItem,
  type ScheduleRow,
} from "@/lib/finance/schedule-builder";

type Preference = "standard" | "quarter_prepay" | "full_prepay";

// Program-centric billing with auto-trim.
// POST { enrollment_id, course_ids: string[] (phases the student IS doing),
//        tier?, payment_preference, action: 'preview' | 'commit' }
// Generates the full schedule across the selected phases; on commit it also
// removes plans for any of the program's phases NOT selected (the trim).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to manage finance settings" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const enrollmentId: string = body.enrollment_id;
  const selected: string[] = Array.isArray(body.course_ids) ? body.course_ids : [];
  const action: "preview" | "commit" = body.action ?? "preview";
  const preference: Preference = body.payment_preference ?? "standard";
  const tierOverride: Tier | undefined = body.tier;

  if (!enrollmentId) {
    return NextResponse.json(
      { error: "enrollment_id is required" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: enrollment, error: enrErr } = await db
    .from("enrollments")
    .select(
      "id, user_id, program_id, enrolled_at, users!enrollments_user_id_fkey(id, nationality)"
    )
    .eq("id", enrollmentId)
    .single();
  if (enrErr || !enrollment) {
    return NextResponse.json({ error: "Enrollment not found" }, { status: 404 });
  }

  // Resolve tier
  let tier: Tier = tierOverride ?? "A";
  if (!tierOverride) {
    const tierMap = await getCountryTierMap(supabase);
    const nat = (enrollment.users?.nationality ?? "").toLowerCase().trim();
    tier = tierMap[nat] ?? "A";
  }
  const region = getXeroRegionForStudent(enrollment.users?.nationality ?? null);
  const acceptanceDate = (
    enrollment.enrolled_at ?? new Date().toISOString()
  ).split("T")[0];

  // All phases (courses) in the program
  const { data: courses } = await db
    .from("billing_courses")
    .select("id, code, name, sequence, arrival_date, start_date")
    .eq("program_id", enrollment.program_id)
    .order("sequence", { ascending: true });

  const allCourses = courses ?? [];
  const selectedSet = new Set(selected);

  // Build per included phase
  const warnings: string[] = [];
  const perPhase: Array<{
    course: { id: string; code: string; name: string };
    rows: ScheduleRow[];
    total: number;
  }> = [];

  for (const course of allCourses) {
    if (!selectedSet.has(course.id)) continue;
    const { data: items } = await db
      .from("fee_charge_items")
      .select("*")
      .eq("course_id", course.id)
      .eq("tier", tier)
      .eq("active", true);

    const groupYear = course.start_date
      ? Number(String(course.start_date).split("-")[0])
      : null;

    const built = buildSchedule((items ?? []) as BuilderChargeItem[], {
      acceptanceDate,
      arrivalDate: course.arrival_date ?? null,
      groupYear,
      paymentPreference: preference,
    });
    built.warnings.forEach((w) => warnings.push(`${course.name}: ${w}`));
    perPhase.push({
      course: { id: course.id, code: course.code, name: course.name },
      rows: built.rows,
      total: scheduleTotal(built.rows),
    });
  }

  const combined = perPhase
    .flatMap((p) => p.rows.map((r) => ({ ...r, phase: p.course.code })))
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const grandTotal = perPhase.reduce((s, p) => s + p.total, 0);

  if (action === "preview") {
    return NextResponse.json({
      success: true,
      tier,
      region,
      grandTotal,
      perPhase: perPhase.map((p) => ({
        course: p.course,
        total: p.total,
        count: p.rows.length,
      })),
      rows: combined,
      warnings,
    });
  }

  // ── Commit: upsert selected phases, trim (delete) the rest ──
  let created = 0;
  let trimmed = 0;
  for (const course of allCourses) {
    if (selectedSet.has(course.id)) {
      const phase = perPhase.find((p) => p.course.id === course.id);
      if (!phase) continue;
      const { data: plan, error: planErr } = await upsertBillingPlan(supabase, {
        enrollment_id: enrollmentId,
        user_id: enrollment.user_id,
        program_id: enrollment.program_id,
        course_id: course.id,
        tier,
        tier_override: !!tierOverride,
        payment_preference: preference,
        xero_region: region,
        created_by: user.id,
      });
      if (planErr || !plan) {
        return NextResponse.json(
          { error: planErr?.message ?? "Failed to save plan" },
          { status: 500 }
        );
      }
      const payload = phase.rows.map((r) => ({
        charge_item_id: r.charge_item_id ?? null,
        charge_type: r.charge_type,
        label: r.label,
        sequence: r.sequence,
        amount_zar: r.amount_zar,
        xero_item_code: r.xero_item_code,
        scheduled_generation_date: r.scheduled_generation_date,
        due_date: r.due_date,
        combined_group_key: r.combined_group_key,
        status: "scheduled",
      }));
      const { error: rowsErr } = await replaceScheduledRows(
        supabase,
        plan.id,
        payload
      );
      if (rowsErr) {
        return NextResponse.json({ error: rowsErr.message }, { status: 500 });
      }
      created++;
    } else {
      // Auto-trim: remove any existing plan for a phase the student isn't doing.
      await deleteBillingPlanForEnrollmentCourse(supabase, enrollmentId, course.id);
      trimmed++;
    }
  }

  return NextResponse.json({
    success: true,
    tier,
    region,
    grandTotal,
    phasesBilled: created,
    phasesTrimmed: trimmed,
    warnings,
  });
}
