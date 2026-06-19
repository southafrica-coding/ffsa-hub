import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  upsertBillingPlan,
  replaceScheduledRows,
  getCountryTierMap,
  type Tier,
} from "@/services/school-billing";
import { getXeroRegionForStudent } from "@/services/xero";
import { canManageFinance } from "@/lib/api-auth";
import {
  buildSchedule,
  scheduleTotal,
  type BuilderChargeItem,
} from "@/lib/finance/schedule-builder";

type Preference = "standard" | "quarter_prepay" | "full_prepay";

// POST { enrollment_id, tier?, payment_preference, action: 'preview' | 'commit' }
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

  // 1. Load enrollment + student
  const { data: enrollment, error: enrErr } = await db
    .from("enrollments")
    .select(
      "id, user_id, program_id, enrolled_at, users!enrollments_user_id_fkey(id, nationality)"
    )
    .eq("id", enrollmentId)
    .single();

  if (enrErr || !enrollment) {
    return NextResponse.json(
      { error: "Enrollment not found" },
      { status: 404 }
    );
  }

  // 2. Load course (program) + its program group
  const { data: course } = await db
    .from("programs")
    .select(
      "id, program_group_id, billing_arrival_date, program_groups(id, year)"
    )
    .eq("id", enrollment.program_id)
    .single();

  // 3. Resolve tier (explicit override → country tier → 'A')
  let tier: Tier = tierOverride ?? "A";
  if (!tierOverride) {
    const tierMap = await getCountryTierMap(supabase);
    const nat = (enrollment.users?.nationality ?? "").toLowerCase().trim();
    tier = tierMap[nat] ?? "A";
  }

  // 4. Load charge items for this course + tier
  const { data: items } = await db
    .from("fee_charge_items")
    .select("*")
    .eq("program_id", enrollment.program_id)
    .eq("tier", tier)
    .eq("active", true);

  const acceptanceDate = (enrollment.enrolled_at ?? new Date().toISOString()).split(
    "T"
  )[0];

  const { rows, warnings } = buildSchedule(
    (items ?? []) as BuilderChargeItem[],
    {
      acceptanceDate,
      arrivalDate: course?.billing_arrival_date ?? null,
      groupYear: course?.program_groups?.year ?? null,
      paymentPreference: preference,
    }
  );

  const region = getXeroRegionForStudent(enrollment.users?.nationality ?? null);

  // ── Preview only ──
  if (action === "preview") {
    return NextResponse.json({
      success: true,
      tier,
      region,
      total: scheduleTotal(rows),
      rows,
      warnings,
    });
  }

  // ── Commit ──
  const { data: plan, error: planErr } = await upsertBillingPlan(supabase, {
    enrollment_id: enrollmentId,
    user_id: enrollment.user_id,
    program_id: enrollment.program_id,
    program_group_id: course?.program_group_id ?? null,
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

  const payload = rows.map((r) => ({
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

  return NextResponse.json({
    success: true,
    tier,
    region,
    planId: plan.id,
    total: scheduleTotal(rows),
    rowCount: rows.length,
    warnings,
  });
}
