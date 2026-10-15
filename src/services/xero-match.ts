// ────────────────────────────────────────────────────────────
// FFSA Hub — Match to Xero: bring a school's existing Xero invoicing into the Hub
// ────────────────────────────────────────────────────────────
// A school switching to Hub billing mid-year has students with no Hub plan
// and charges finance already invoiced by hand. Three steps, each safe to
// repeat:
//   1. setUpMissingPlans — a plan for every student without one, built from
//      the school's schedules. Invoices nothing; anything already due to
//      invoice is held for a decision.
//   2. checkProgramAgainstXero — read-only: each student's Xero invoices
//      (contact found by email, as invoicing does) matched to their charges
//      by item code (src/lib/finance/xero-match.ts).
//   3. linkMatches — record the chosen matches on the charges, then read
//      their payments back. A linked charge is never invoiced again.
// ────────────────────────────────────────────────────────────

import { commitPlanForEnrollment } from "@/services/billing-generation";
import { billingBlockedReason, getEnrolledStudentsForProgram, type Tier } from "@/services/school-billing";
import { getXeroInvoicesForEmails, getXeroRegionForStudent, type XeroRegion } from "@/services/xero";
import { syncInvoicePayments } from "@/services/billing-payments";
import { matchStudentInvoices, hubStatusForXero, LINKABLE, type StudentMatch } from "@/lib/finance/xero-match";
import { todayInSouthAfrica } from "@/lib/finance/student-balance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Enrollment = {
  id: string;
  user_id: string;
  program_id?: string;
  status: string;
  enrolled_at: string | null;
  users: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
    nationality: string | null;
  } | null;
};

type ChargeRow = {
  id: string;
  plan_id: string;
  label: string;
  xero_item_code: string | null;
  amount_zar: number;
  due_date: string;
  scheduled_generation_date: string;
  status: string;
  xero_invoice_id: string | null;
};

type PlanRow = { id: string; enrollment_id: string; tier: Tier; xero_region: XeroRegion | null; course_id: string | null };

async function loadStudents(supabase: Client, programId: string): Promise<Enrollment[]> {
  const { data, error } = await getEnrolledStudentsForProgram(supabase, programId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Enrollment[];
}

async function loadPlans(supabase: Client, programId: string) {
  const { data: plans, error } = await supabase
    .from("student_billing_plans")
    .select("id, enrollment_id, tier, xero_region, course_id")
    .eq("program_id", programId);
  if (error) throw new Error(error.message);
  const planRows = (plans ?? []) as PlanRow[];
  const charges: ChargeRow[] = [];
  const ids = planRows.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 100) {
    // Paged: PostgREST silently caps a read at 1000 rows.
    for (let from = 0; ; from += 1000) {
      const { data, error: e } = await supabase
        .from("student_billing_schedule")
        .select("id, plan_id, label, xero_item_code, amount_zar, due_date, scheduled_generation_date, status, xero_invoice_id")
        .in("plan_id", ids.slice(i, i + 100))
        .order("id")
        .range(from, from + 999);
      if (e) throw new Error(e.message);
      charges.push(...((data ?? []) as ChargeRow[]));
      if (!data || data.length < 1000) break;
    }
  }
  return { plans: planRows, charges };
}

/**
 * A charge that would invoice today is held instead: these plans are built
 * for students accepted long ago, and nothing may invoice until finance has
 * matched them against what Xero already holds.
 */
export async function holdDueNow(supabase: Client, planIds: string[]) {
  if (planIds.length === 0) return;
  await supabase
    .from("student_billing_schedule")
    .update({ status: "needs_decision" })
    .in("plan_id", planIds)
    .eq("status", "scheduled")
    .lte("scheduled_generation_date", todayInSouthAfrica());
}

const nameOf = (e: Enrollment) =>
  [e.users?.preferred_name || e.users?.first_name, e.users?.last_name].filter(Boolean).join(" ") || "Student";

// ── 1. Set up billing for everyone ──────────────────────────

export interface SetupResult {
  created: Array<{ enrollmentId: string; name: string }>;
  failed: Array<{ enrollmentId: string; name: string; error: string }>;
  alreadySetUp: number;
  warnings: string[];
}

export async function setUpMissingPlans(supabase: Client, programId: string, createdBy: string | null): Promise<SetupResult> {
  const blocked = await billingBlockedReason(supabase, programId);
  if (blocked) throw new Error(blocked);

  const students = await loadStudents(supabase, programId);
  const { plans, charges } = await loadPlans(supabase, programId);
  const withCharges = new Set(charges.map((c) => plans.find((p) => p.id === c.plan_id)?.enrollment_id));

  const out: SetupResult = { created: [], failed: [], alreadySetUp: 0, warnings: [] };
  for (const e of students) {
    if (withCharges.has(e.id)) {
      out.alreadySetUp++;
      continue;
    }
    // Empty plans (left by an old bug) are cleared and built again.
    await supabase.from("student_billing_plans").delete().eq("enrollment_id", e.id);
    const res = await commitPlanForEnrollment(supabase, { ...e, program_id: programId }, createdBy);
    if (!res.ok) {
      out.failed.push({ enrollmentId: e.id, name: nameOf(e), error: res.error ?? "Couldn't build the plan" });
      continue;
    }
    const { data: mine } = await supabase.from("student_billing_plans").select("id").eq("enrollment_id", e.id);
    await holdDueNow(supabase, ((mine ?? []) as { id: string }[]).map((p) => p.id));
    out.created.push({ enrollmentId: e.id, name: nameOf(e) });
    for (const w of res.warnings ?? []) if (!out.warnings.includes(w)) out.warnings.push(w);
  }
  return out;
}

// ── 2. Check Xero (read-only) ───────────────────────────────

export interface StudentCheck {
  enrollmentId: string;
  name: string;
  email: string | null;
  region: XeroRegion;
  tier: Tier | null;
  hasPlan: boolean;
  /** Charges still waiting to be invoiced by the Hub. */
  openCharges: number;
  xeroContact: boolean;
  match: StudentMatch | null;
}

export interface ProgramCheck {
  students: StudentCheck[];
  errors: string[];
}

export async function checkProgramAgainstXero(supabase: Client, programId: string): Promise<ProgramCheck> {
  const students = await loadStudents(supabase, programId);
  const { plans, charges } = await loadPlans(supabase, programId);

  const [{ data: progItems }, { data: courseItems }] = await Promise.all([
    supabase.from("program_charge_items").select("xero_item_code").eq("program_id", programId),
    supabase
      .from("fee_charge_items")
      .select("xero_item_code, billing_courses!inner(program_id)")
      .eq("billing_courses.program_id", programId),
  ]);
  const schoolCodes = new Set<string>(
    [...(progItems ?? []), ...(courseItems ?? []), ...charges]
      .map((r: { xero_item_code: string | null }) => r.xero_item_code)
      .filter((c): c is string => !!c)
  );

  const regionOf = (e: Enrollment): XeroRegion =>
    plans.find((p) => p.enrollment_id === e.id)?.xero_region ?? getXeroRegionForStudent(e.users?.nationality ?? null);

  const errors: string[] = [];
  const found = new Map<XeroRegion, Awaited<ReturnType<typeof getXeroInvoicesForEmails>>>();
  for (const region of ["za", "us"] as XeroRegion[]) {
    const emails = students.filter((e) => regionOf(e) === region && e.users?.email).map((e) => e.users!.email!);
    if (emails.length === 0) continue;
    const res = await getXeroInvoicesForEmails(supabase, region, emails);
    if (res.error) errors.push(`${region === "us" ? "US" : "SA"} Xero: ${res.error}`);
    found.set(region, res);
  }

  const result: StudentCheck[] = students.map((e) => {
    const region = regionOf(e);
    const myPlans = plans.filter((p) => p.enrollment_id === e.id);
    const planIds = new Set(myPlans.map((p) => p.id));
    const mine = charges.filter((c) => planIds.has(c.plan_id));
    const email = e.users?.email?.trim().toLowerCase() ?? null;
    const xero = found.get(region);
    const invoices = email ? xero?.data.get(email) ?? [] : [];
    return {
      enrollmentId: e.id,
      name: nameOf(e),
      email: e.users?.email ?? null,
      region,
      tier: myPlans[0]?.tier ?? null,
      hasPlan: mine.length > 0,
      openCharges: mine.filter((c) => LINKABLE.has(c.status) && !c.xero_invoice_id).length,
      xeroContact: !!email && !!xero?.contacts.has(email),
      match: mine.length > 0 || invoices.length > 0 ? matchStudentInvoices(mine, invoices, { schoolCodes }) : null,
    };
  });
  result.sort((a, b) => a.name.localeCompare(b.name));
  return { students: result, errors };
}

// ── 3. Link ─────────────────────────────────────────────────

export interface LinkResult {
  linked: number;
  skipped: number;
  paymentsUpdated: number;
  errors: string[];
}

/**
 * Links the chosen charge ↔ invoice pairs. Xero is read again first and only
 * pairs the matcher still proposes are applied, so a stale screen can't link
 * the wrong thing.
 */
export async function linkMatches(
  supabase: Client,
  programId: string,
  pairs: Array<{ chargeId: string; invoiceId: string }>
): Promise<LinkResult> {
  const fresh = await checkProgramAgainstXero(supabase, programId);
  if (fresh.errors.length) throw new Error(fresh.errors.join(" · "));
  const proposed = new Map(
    fresh.students.flatMap((s) => s.match?.links ?? []).map((l) => [`${l.chargeId}|${l.invoiceId}`, l])
  );

  const out: LinkResult = { linked: 0, skipped: 0, paymentsUpdated: 0, errors: [] };
  const invoiceIds = new Set<string>();
  for (const p of pairs) {
    const l = proposed.get(`${p.chargeId}|${p.invoiceId}`);
    if (!l) {
      out.skipped++;
      continue;
    }
    const status = hubStatusForXero(l.invoiceStatus);
    const { data, error } = await supabase
      .from("student_billing_schedule")
      .update({
        status,
        xero_invoice_id: l.invoiceId,
        xero_invoice_number: l.invoiceNumber,
        generated_at: new Date().toISOString(),
        notes: "Linked to an existing Xero invoice (Match to Xero)",
        ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
      })
      .eq("id", l.chargeId)
      .in("status", [...LINKABLE])
      .is("xero_invoice_id", null)
      .select("id");
    if (error) out.errors.push(`${l.invoiceNumber ?? l.invoiceId}: ${error.message}`);
    else if ((data ?? []).length === 0) out.skipped++;
    else {
      out.linked++;
      invoiceIds.add(l.invoiceId);
    }
  }

  if (invoiceIds.size > 0) {
    const sync = await syncInvoicePayments(supabase, { invoiceIds: [...invoiceIds] });
    out.paymentsUpdated = sync.chargesUpdated;
    out.errors.push(...sync.errors);
  }
  return out;
}

// ── Tier switch ─────────────────────────────────────────────

/**
 * Rebuilds one student's plan at another tier — when Xero shows finance
 * invoiced them at a different tier than nationality gives. Refused once any
 * charge is invoiced or linked, so nothing real is ever thrown away.
 */
export async function switchStudentTier(
  supabase: Client,
  programId: string,
  enrollmentId: string,
  tier: Tier,
  createdBy: string | null
): Promise<{ ok: boolean; error?: string }> {
  const { data: e } = await supabase
    .from("enrollments")
    .select("id, user_id, program_id, status, enrolled_at, users!enrollments_user_id_fkey(nationality)")
    .eq("id", enrollmentId)
    .eq("program_id", programId)
    .single();
  if (!e) return { ok: false, error: "Student not found on this school" };

  const { data: rows } = await supabase
    .from("student_billing_schedule")
    .select("id, student_billing_plans!inner(enrollment_id)")
    .eq("student_billing_plans.enrollment_id", enrollmentId)
    .not("xero_invoice_id", "is", null)
    .limit(1);
  if ((rows ?? []).length > 0) {
    return { ok: false, error: "Some of this student's charges are already invoiced or linked — change the tier by hand." };
  }

  await supabase.from("student_billing_plans").delete().eq("enrollment_id", enrollmentId);
  const res = await commitPlanForEnrollment(supabase, e, createdBy, { tierOverride: tier });
  if (!res.ok) return { ok: false, error: res.error ?? "Couldn't rebuild the plan" };
  const { data: mine } = await supabase.from("student_billing_plans").select("id").eq("enrollment_id", enrollmentId);
  await holdDueNow(supabase, ((mine ?? []) as { id: string }[]).map((p) => p.id));
  return { ok: true };
}
