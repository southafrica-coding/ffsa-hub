import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { createAuditLog } from "@/services/audit";
import { compileSchedule, type PaymentScheduleDesign } from "@/lib/finance/payment-schedule";

// Per-school payment schedule designs (migration 236).
//
// PUT { programId, courseId: string | null, design, replaceManual?: boolean }
//   Saves the design and COMPILES it into the target's charge items, replacing
//   every charge there. courseId null = whole-program pricing.
//   If the target has hand-made charges, the first call returns 409
//   needsConfirm; send replaceManual: true to go ahead.
// DELETE ?programId=&courseId=   removes the design and the charges it made.
//
// Students already scheduled keep the rows they have — a schedule change
// applies to students set up after it (or rebuilt on their billing page).

type Target = { programId: string; courseId: string | null; table: "program_charge_items" | "fee_charge_items" };

async function authorise() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await canManageFinance(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "You don't have permission to change payment schedules" },
        { status: 403 }
      ),
    };
  }
  return { supabase, user };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Resolve and check the pricing target. Returns the course's arrival date too. */
async function resolveTarget(
  admin: Admin,
  programId: unknown,
  courseId: unknown
): Promise<{ target: Target; arrivalDate: string | null } | { error: string; status: number }> {
  if (typeof programId !== "string" || !programId) return { error: "programId is required", status: 400 };
  if (courseId != null && typeof courseId !== "string") return { error: "courseId must be a string or null", status: 400 };

  const { data: program } = await admin.from("programs").select("id").eq("id", programId).maybeSingle();
  if (!program) return { error: "School not found", status: 404 };

  if (!courseId) {
    return { target: { programId, courseId: null, table: "program_charge_items" }, arrivalDate: null };
  }
  const { data: course } = await admin
    .from("billing_courses")
    .select("id, program_id, arrival_date")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || course.program_id !== programId) return { error: "Course not found in this school", status: 404 };
  return {
    target: { programId, courseId, table: "fee_charge_items" },
    arrivalDate: course.arrival_date ?? null,
  };
}

const targetColumn = (t: Target) =>
  t.courseId ? { column: "course_id", id: t.courseId } : { column: "program_id", id: t.programId };

export async function PUT(request: Request) {
  const auth = await authorise();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const admin: Admin = createAdminClient();
  const resolved = await resolveTarget(admin, body.programId, body.courseId ?? null);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { target, arrivalDate } = resolved;

  const design = body.design as PaymentScheduleDesign | undefined;
  if (!design || typeof design !== "object" || !Array.isArray(design.payments) || !design.tierPrices) {
    return NextResponse.json({ error: "A schedule design is required" }, { status: 400 });
  }

  const compiled = compileSchedule(design, { hasArrivalDate: !!arrivalDate });
  if (compiled.errors.length > 0) {
    return NextResponse.json({ error: compiled.errors[0], errors: compiled.errors }, { status: 400 });
  }

  const tc = targetColumn(target);

  // Hand-made charges on this target would double-bill alongside the
  // schedule's, so saving replaces them — but only once someone says so.
  const { count: manualCount, error: manualErr } = await admin
    .from(target.table)
    .select("id", { count: "exact", head: true })
    .eq(tc.column, tc.id)
    .is("schedule_payment_key", null);
  if (manualErr) return NextResponse.json({ error: manualErr.message }, { status: 500 });
  if ((manualCount ?? 0) > 0 && !body.replaceManual) {
    return NextResponse.json(
      {
        error: `This pricing has ${manualCount} hand-made charge${manualCount === 1 ? "" : "s"}. Saving the schedule replaces them.`,
        needsConfirm: true,
        manualCount,
      },
      { status: 409 }
    );
  }

  // 1. The design itself.
  let existingQ = admin.from("billing_schedules").select("id").eq("program_id", target.programId);
  existingQ = target.courseId ? existingQ.eq("course_id", target.courseId) : existingQ.is("course_id", null);
  const { data: existing } = await existingQ.maybeSingle();
  const designRow = {
    program_id: target.programId,
    course_id: target.courseId,
    tier_prices: design.tierPrices,
    payments: design.payments,
    updated_by: auth.user.id,
  };
  const saved = existing
    ? await admin.from("billing_schedules").update(designRow).eq("id", existing.id).select("id").single()
    : await admin.from("billing_schedules").insert(designRow).select("id").single();
  if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 500 });

  // 2. Replace the target's charges with the compiled ones.
  const del = await admin.from(target.table).delete().eq(tc.column, tc.id);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  if (compiled.items.length > 0) {
    const rows = compiled.items.map((i) => ({ ...i, [tc.column]: tc.id }));
    const ins = await admin.from(target.table).insert(rows);
    if (ins.error) {
      return NextResponse.json(
        { error: `The schedule was saved but its charges couldn't be written: ${ins.error.message}. Save again.` },
        { status: 500 }
      );
    }
  }

  // Students already set up keep their rows; say how many so nobody assumes
  // they moved too.
  let plansQ = admin
    .from("student_billing_plans")
    .select("id", { count: "exact", head: true })
    .eq("program_id", target.programId);
  plansQ = target.courseId ? plansQ.eq("course_id", target.courseId) : plansQ.is("course_id", null);
  const { count: existingPlans } = await plansQ;

  await createAuditLog(auth.supabase, {
    action: "billing_schedule.save",
    resource_type: "program",
    resource_id: target.programId,
    changes: {
      course_id: target.courseId,
      tier_prices: design.tierPrices,
      payments: design.payments.length,
      replaced_manual: manualCount ?? 0,
    },
  });

  return NextResponse.json({
    success: true,
    warnings: compiled.warnings,
    charges: compiled.items.length,
    existingPlans: existingPlans ?? 0,
  });
}

export async function DELETE(request: Request) {
  const auth = await authorise();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const admin: Admin = createAdminClient();
  const resolved = await resolveTarget(admin, url.searchParams.get("programId"), url.searchParams.get("courseId"));
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { target } = resolved;
  const tc = targetColumn(target);

  let q = admin.from("billing_schedules").delete().eq("program_id", target.programId);
  q = target.courseId ? q.eq("course_id", target.courseId) : q.is("course_id", null);
  const del = await q;
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });

  const chg = await admin.from(target.table).delete().eq(tc.column, tc.id).not("schedule_payment_key", "is", null);
  if (chg.error) return NextResponse.json({ error: chg.error.message }, { status: 500 });

  await createAuditLog(auth.supabase, {
    action: "billing_schedule.delete",
    resource_type: "program",
    resource_id: target.programId,
    changes: { course_id: target.courseId },
  });
  return NextResponse.json({ success: true });
}
