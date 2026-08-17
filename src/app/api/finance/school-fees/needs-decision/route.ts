import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import { resolveHeldCharge } from "@/lib/finance/schedule-builder";

/**
 * The held-charge queue (design frame 20b, handoff §4).
 *
 * GET  — everything currently held, for a student or a whole school.
 * POST — resolve a student's held charges with ONE of three outcomes.
 *
 * The rule the whole feature exists to protect: **no resolution ever produces
 * a past-dated invoice.** Both "issue" outcomes move the generation date to
 * today. "Start from now" cancels the charge and keeps it in history rather
 * than deleting it, so the record still shows she was never billed for a
 * period she was not here for.
 *
 * Resolution does not talk to Xero. It moves rows into the state the normal
 * generation step reads, so the dry-run → create → send sequence stays the one
 * and only path that creates an invoice.
 */

const OUTCOMES = ["catch_up_single", "issue_separately", "start_from_now"] as const;
type Outcome = (typeof OUTCOMES)[number];

const HELD_SELECT = `
  id, plan_id, charge_type, label, amount_zar, due_date,
  scheduled_generation_date, status, combined_group_key,
  plan:plan_id(
    id, enrollment_id, program_id,
    enrollment:enrollment_id(
      id,
      user:user_id(id, first_name, last_name, preferred_name, email)
    )
  )
`;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to manage finance settings" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const q = db.from("student_billing_schedule").select(HELD_SELECT).eq("status", "needs_decision");

    const enrollmentId = url.searchParams.get("enrollmentId");
    const programId = url.searchParams.get("programId");

    const { data, error } = await q.order("due_date", { ascending: true });
    if (error) return NextResponse.json({ rows: [] });

    // Filtered after the read: the relationship is two joins deep, which
    // PostgREST cannot express as a top-level filter without an inner-join
    // that would silently drop rows whose plan is missing.
    type Row = {
      plan?: { enrollment_id?: string; program_id?: string } | null;
    };
    const rows = ((data ?? []) as Row[]).filter((r) => {
      if (enrollmentId && r.plan?.enrollment_id !== enrollmentId) return false;
      if (programId && r.plan?.program_id !== programId) return false;
      return true;
    });

    return NextResponse.json({ rows });
  } catch {
    // Migration 173 not applied — nothing can be held yet.
    return NextResponse.json({ rows: [] });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to manage finance settings" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const outcome = body?.outcome as Outcome | undefined;
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];

  if (!outcome || !OUTCOMES.includes(outcome)) {
    return NextResponse.json(
      { error: "outcome must be catch_up_single, issue_separately or start_from_now" },
      { status: 400 }
    );
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: "No charges selected" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const today = new Date().toISOString().slice(0, 10);

  // Only ever touch rows that are actually held. A stale tab must not be able
  // to re-date something already generated or paid.
  const { data: held, error: readErr } = await db
    .from("student_billing_schedule")
    .select("id, status")
    .in("id", ids)
    .eq("status", "needs_decision");

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const heldIds = ((held ?? []) as { id: string }[]).map((r) => r.id);
  if (heldIds.length === 0) {
    return NextResponse.json(
      { error: "Those charges are no longer held — someone may have resolved them already." },
      { status: 409 }
    );
  }

  const stamp = {
    decision_outcome: outcome,
    decided_by: user.id,
    decided_at: new Date().toISOString(),
  };

  // The date arithmetic lives in schedule-builder.ts so "never a past
  // generation date" is a tested rule rather than a line in a route.
  const patch: Record<string, unknown> = {
    ...stamp,
    ...resolveHeldCharge(outcome, today, `catchup-${user.id.slice(0, 8)}-${today}`),
  };

  const { error: updErr } = await db
    .from("student_billing_schedule")
    .update(patch)
    .in("id", heldIds);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    outcome,
    resolved: heldIds.length,
    // Said plainly so the UI never implies an invoice already went out.
    note:
      outcome === "start_from_now"
        ? "Dropped. Nothing will be invoiced for those periods."
        : "Moved to today's generation. Nothing has been sent yet — the invoice run still has to create it.",
  });
}
