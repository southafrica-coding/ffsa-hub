import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { createAuditLog } from "@/services/audit";

// Per-school billing settings (migration 172): billing_mode,
// billing_emails_enabled, schedule_start_date. The invoice run reads these
// through src/lib/finance/invoice-run-policy.ts.
//
// PATCH { programId, billing_mode?, billing_emails_enabled?,
//         schedule_start_date?: 'YYYY-MM-DD' | null, confirmPending?: boolean }
//
// Switching a school to `external` while it still has charges waiting to be
// invoiced needs confirmPending: those charges are kept (never deleted) and
// the run simply skips them while the school is outside the Hub.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to change school billing settings" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const programId: unknown = body.programId;
  if (typeof programId !== "string" || !programId) {
    return NextResponse.json({ error: "programId is required" }, { status: 400 });
  }

  const patch: {
    billing_mode?: "external" | "hub_scheduled";
    billing_emails_enabled?: boolean;
    schedule_start_date?: string | null;
  } = {};
  if (body.billing_mode !== undefined) {
    if (body.billing_mode !== "external" && body.billing_mode !== "hub_scheduled") {
      return NextResponse.json({ error: "Unknown billing mode" }, { status: 400 });
    }
    patch.billing_mode = body.billing_mode;
  }
  if (body.billing_emails_enabled !== undefined) {
    if (typeof body.billing_emails_enabled !== "boolean") {
      return NextResponse.json({ error: "billing_emails_enabled must be true or false" }, { status: 400 });
    }
    patch.billing_emails_enabled = body.billing_emails_enabled;
  }
  if (body.schedule_start_date !== undefined) {
    const d = body.schedule_start_date;
    if (d !== null && (typeof d !== "string" || !DATE_RE.test(d) || Number.isNaN(Date.parse(d)))) {
      return NextResponse.json({ error: "Start date must be a valid date" }, { status: 400 });
    }
    patch.schedule_start_date = d || null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  // Finance access was checked above; the admin client keeps this route
  // working for finance staff who are not school leaders under programs RLS.
  // Untyped: the generated types predate migrations 095/172.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: before, error: readError } = await admin
    .from("programs")
    .select("id, name, billing_mode, billing_emails_enabled, schedule_start_date")
    .eq("id", programId)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  if (patch.billing_mode === "external" && before.billing_mode !== "external" && !body.confirmPending) {
    const { count, error: countError } = await admin
      .from("student_billing_schedule")
      .select("id, student_billing_plans!inner(program_id)", { count: "exact", head: true })
      .eq("student_billing_plans.program_id", programId)
      .in("status", ["scheduled", "needs_decision"]);
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `${before.name} has ${count} charge${count === 1 ? "" : "s"} waiting to be invoiced.`,
          pendingCharges: count,
          needsConfirm: true,
        },
        { status: 409 }
      );
    }
  }

  const { data: after, error: updateError } = await admin
    .from("programs")
    .update(patch)
    .eq("id", programId)
    .select("id, billing_mode, billing_emails_enabled, schedule_start_date")
    .single();
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
  }
  if (Object.keys(changes).length > 0) {
    await createAuditLog(supabase, {
      action: "program.billing_settings.update",
      resource_type: "program",
      resource_id: programId,
      changes,
    });
  }

  return NextResponse.json({ success: true, settings: after });
}
