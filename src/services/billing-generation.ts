// ────────────────────────────────────────────────────────────
// FFSA Hub — Scheduled invoice generation
// ────────────────────────────────────────────────────────────
// Finds billing-schedule rows whose generation date has arrived and
// pushes them to Xero, honouring each school's billing settings (mode,
// start date, email hold). Rows sharing a (plan, combined_group_key | due_date)
// become ONE invoice with multiple line items (e.g. Mar 4 outreach +
// monthly = one R51k invoice). Idempotent: only acts on 'scheduled' rows
// and flips them to 'generated'/'sent' so the cron never double-creates.
// ────────────────────────────────────────────────────────────

import {
  createScheduledInvoice,
  getXeroRegionForStudent,
  getXeroTrackingOptions,
  getXeroBrandingThemes,
  type XeroRegion,
} from "@/services/xero";
import { chooseTemplate, sendSchoolInvoiceEmail, type StoredTemplate } from "@/services/invoice-email-delivery";
import { getCountryTierMap, billingBlockedReason, type Tier } from "@/services/school-billing";
import { commitWholeProgramPlan, commitSegmentPlans } from "@/services/billing-plan-builder";
import {
  decideInvoiceGroup,
  resolveTracking,
  SKIP_REASON_TEXT,
  type TrackingLookup,
  type SchoolBillingSettings,
  type SkipReason,
} from "@/lib/finance/invoice-run-policy";
import { XERO_SCHOOLS_TRACKING_CATEGORY } from "@/lib/finance/billing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const studentName = (u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}) =>
  `${u.first_name || ""} ${u.last_name || ""}`.trim() ||
  "Student";

export interface GenerationResult {
  asOf: string;
  dryRun: boolean;
  autoSend: boolean;
  invoices: Array<{
    planId: string;
    student: string;
    dueDate: string;
    total: number;
    rowIds: string[];
    status: "preview" | "generated" | "sent" | "failed" | "skipped";
    /** Whether this invoice is (or would be) authorised + emailed. False =
     * a Xero draft because the school's sending is held. */
    send?: boolean;
    /** The school email template used (or that would be). */
    emailTemplate?: string;
    invoiceNumber?: string;
    error?: string;
    /** Why a 'skipped' line was left alone (rows stay 'scheduled'). */
    reason?: string;
    /** Lines that couldn't be tagged with their Xero "Schools" option. */
    warnings?: string[];
  }>;
}

/**
 * Generate every due invoice, school by school.
 *
 * `autoSend` is a ceiling, not a decision: each school's own settings
 * (src/lib/finance/invoice-run-policy.ts) decide whether its invoices are
 * emailed, held as Xero drafts, or skipped entirely.
 */
export async function generateDueInvoices(
  supabase: Client,
  opts: { asOf: string; dryRun: boolean; autoSend: boolean; planIds?: string[] }
): Promise<GenerationResult> {
  const { asOf, dryRun, autoSend, planIds } = opts;

  let query = supabase
    .from("student_billing_schedule")
    .select(
      "id, plan_id, charge_type, label, amount_zar, xero_item_code, xero_tracking_option, due_date, combined_group_key, scheduled_generation_date, student_billing_plans!inner(id, user_id, program_id, xero_region, users!student_billing_plans_user_id_fkey(email, first_name, last_name, preferred_name, nationality))"
    )
    .eq("status", "scheduled")
    .lte("scheduled_generation_date", asOf);
  if (planIds && planIds.length > 0) query = query.in("plan_id", planIds);
  const { data: rows, error: rowsError } = await query;
  if (rowsError) throw new Error(`Could not read the billing schedule: ${rowsError.message}`);

  // Each school's billing settings, read once. A school missing from this map
  // is treated as external by the policy — never billed by default.
  const programIds = [
    ...new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rows ?? []).map((r: any) => r.student_billing_plans?.program_id).filter(Boolean)
    ),
  ];
  type SchoolRow = SchoolBillingSettings & {
    email_template_za_id?: string | null;
    email_template_us_id?: string | null;
    xero_branding_theme_za?: string | null;
    xero_branding_theme_us?: string | null;
  };
  const schools = new Map<string, SchoolRow>();
  if (programIds.length > 0) {
    const { data: programs, error: progError } = await supabase
      .from("programs")
      .select(
        "id, billing_mode, billing_emails_enabled, schedule_start_date, email_template_za_id, email_template_us_id, xero_branding_theme_za, xero_branding_theme_us"
      )
      .in("id", programIds);
    if (progError) {
      throw new Error(`Could not read school billing settings: ${progError.message}`);
    }
    for (const p of programs ?? []) schools.set(p.id, p);
  }

  // Group rows into invoices.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = new Map<string, any[]>();
  for (const r of rows ?? []) {
    const key = `${r.plan_id}::${r.combined_group_key ?? r.due_date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const result: GenerationResult = { asOf, dryRun, autoSend, invoices: [] };
  const nowIso = new Date().toISOString();

  // School email templates (migration 237) — the Hub sends school invoices
  // from these, because Xero's API can't choose a template.
  const { data: templateRows } = await supabase
    .from("invoice_email_templates")
    .select("id, name, xero_region, subject, body, include_online_action, is_default");
  const templates = (templateRows ?? []) as StoredTemplate[];

  // Each organisation's branding themes, by name, read once per run.
  const themesByRegion = new Map<XeroRegion, Promise<Array<{ id: string; name: string }> | null>>();
  const themeId = async (region: XeroRegion, name: string | null | undefined) => {
    if (!name) return { id: null as string | null, warning: null as string | null };
    if (!themesByRegion.has(region)) themesByRegion.set(region, getXeroBrandingThemes(supabase, region));
    const list = await themesByRegion.get(region)!;
    const hit = list?.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());
    return hit
      ? { id: hit.id, warning: null }
      : { id: null, warning: `${region === "us" ? "US" : "SA"} Xero has no branding theme "${name}" — Xero's default was used` };
  };

  // Each organisation's "Schools" options, read once per run and only if a
  // line actually wants tagging.
  const trackingByRegion = new Map<XeroRegion, Promise<TrackingLookup | null>>();
  const trackingFor = (region: XeroRegion) => {
    if (!trackingByRegion.has(region)) {
      trackingByRegion.set(
        region,
        getXeroTrackingOptions(supabase, region, XERO_SCHOOLS_TRACKING_CATEGORY)
      );
    }
    return trackingByRegion.get(region)!;
  };

  for (const allRows of groups.values()) {
    const plan = allRows[0].student_billing_plans;
    const user = plan.users ?? {};
    const name = studentName(user);
    const decision = decideInvoiceGroup(allRows, schools.get(plan.program_id), autoSend);

    // Report what was left alone, one line per reason.
    const byReason = new Map<SkipReason, typeof allRows>();
    for (const { row, reason } of decision.skipped) {
      if (!byReason.has(reason)) byReason.set(reason, []);
      byReason.get(reason)!.push(row);
    }
    for (const [reason, skippedRows] of byReason) {
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate: skippedRows.map((r) => r.due_date).sort()[0],
        total: skippedRows.reduce((s, r) => s + Number(r.amount_zar), 0),
        rowIds: skippedRows.map((r) => r.id),
        status: "skipped",
        reason: SKIP_REASON_TEXT[reason],
      });
    }

    const grp = decision.invoice;
    if (grp.length === 0) continue;
    const send = decision.send;
    const dueDate = grp.map((r) => r.due_date).sort()[0];
    const total = grp.reduce((s, r) => s + Number(r.amount_zar), 0);
    const rowIds = grp.map((r) => r.id);
    const region: XeroRegion =
      plan.xero_region ?? getXeroRegionForStudent(user.nationality ?? null);

    const lookup = grp.some((r) => r.xero_tracking_option) ? await trackingFor(region) : null;
    const resolved = grp.map((r) =>
      resolveTracking(r.xero_tracking_option, lookup, region === "us" ? "US" : "SA")
    );
    const school = schools.get(plan.program_id);
    const template = chooseTemplate(
      templates,
      region,
      region === "us" ? school?.email_template_us_id : school?.email_template_za_id
    );
    const theme = await themeId(region, region === "us" ? school?.xero_branding_theme_us : school?.xero_branding_theme_za);
    const warnings = [
      ...new Set(
        [...resolved.map((t) => t.warning), theme.warning, send && !template ? "No email template for this organisation — invoice approved but not emailed" : null].filter(
          (w): w is string => !!w
        )
      ),
    ];
    const tag = {
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(template ? { emailTemplate: `${region === "us" ? "US" : "SA"} · ${template.name}` } : {}),
    };

    if (dryRun) {
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate,
        total,
        rowIds,
        status: "preview",
        send,
        ...tag,
      });
      continue;
    }

    if (!user.email) {
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate,
        total,
        rowIds,
        status: "failed",
        send,
        error: "No student email on file",
      });
      continue;
    }

    const reference = `FFSA-${String(plan.id).slice(0, 8)}-${dueDate}`;
    const lineItems = grp.map((r, i) => ({
      itemCode: r.xero_item_code,
      description: r.label,
      amount: Number(r.amount_zar),
      tracking: resolved[i].tracking,
    }));

    // send=false → a Xero DRAFT, nobody emailed. send=true → approved in
    // Xero (never emailed BY Xero), then the Hub emails it from the school's
    // own template.
    const inv = await createScheduledInvoice(supabase, {
      region,
      studentEmail: user.email,
      studentName: name,
      dueDate,
      reference,
      lineItems,
      autoSend: send,
      xeroEmail: false,
      brandingThemeId: theme.id,
    });

    let emailed = false;
    let emailError: string | null = null;
    if (inv.success && send && template && inv.invoiceId && inv.status === "AUTHORISED") {
      const delivered = await sendSchoolInvoiceEmail(supabase, {
        region,
        invoiceId: inv.invoiceId,
        template,
        to: user.email,
        firstName: user.first_name ?? "",
        fullName: name,
      });
      emailed = delivered.ok;
      if (!delivered.ok) emailError = delivered.error;
    }

    if (inv.success) {
      const newStatus = emailed ? "sent" : "generated";
      await supabase
        .from("student_billing_schedule")
        .update({
          status: newStatus,
          xero_invoice_id: inv.invoiceId,
          xero_invoice_number: inv.invoiceNumber ?? null,
          generated_at: nowIso,
          sent_at: emailed ? nowIso : null,
        })
        .in("id", rowIds);
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate,
        total,
        rowIds,
        status: newStatus,
        send,
        invoiceNumber: inv.invoiceNumber,
        ...tag,
        ...(emailError ? { error: `Approved in Xero but the email failed: ${emailError}` } : {}),
      });
    } else {
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate,
        total,
        rowIds,
        status: "failed",
        send,
        error: inv.error,
      });
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// On acceptance: set up the full-program billing schedule for a new
// enrolment (all phases), then immediately generate any due invoices
// (the deposit). Non-throwing — callers fire-and-forget so acceptance
// never fails on a billing hiccup. Returns a short summary for logs.
// ────────────────────────────────────────────────────────────
export async function setupProgramBillingOnAcceptance(
  supabase: Client,
  enrollmentId: string,
  createdBy: string | null
): Promise<{ ok: boolean; plansCreated: number; generated: number; note?: string }> {
  try {
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select(
        "id, user_id, program_id, enrolled_at, users!enrollments_user_id_fkey(id, nationality)"
      )
      .eq("id", enrollmentId)
      .single();
    if (!enrollment) return { ok: false, plansCreated: 0, generated: 0, note: "no enrollment" };

    // A school billed outside the Hub must never have charges scheduled
    // against it (docs/redesign/09-going-live.md) — the database refuses
    // this too (migration 172's trigger), but checking here avoids ever
    // hitting that as a raw constraint error mid-acceptance.
    const blocked = await billingBlockedReason(supabase, enrollment.program_id);
    if (blocked) {
      return { ok: true, plansCreated: 0, generated: 0, note: blocked };
    }

    const tierMap = await getCountryTierMap(supabase);
    const nat = (enrollment.users?.nationality ?? "").toLowerCase().trim();
    const tier: Tier = tierMap[nat] ?? "A";
    const region = getXeroRegionForStudent(enrollment.users?.nationality ?? null);
    const acceptanceDate = (
      enrollment.enrolled_at ?? new Date().toISOString()
    ).split("T")[0];

    // The student's track of record (migration 221) — which segment(s) they
    // applied for, or whole-program, copied onto the enrollment at
    // acceptance. No rows means either a program with no segments configured
    // (every program before this feature) or an application that predates
    // it — both fall back to the historical default of whole-program.
    const { data: segmentRows } = await supabase
      .from("enrollment_segments")
      .select("billing_course_id")
      .eq("enrollment_id", enrollmentId);
    const courseIds = (segmentRows ?? [])
      .map((r: { billing_course_id: string | null }) => r.billing_course_id)
      .filter((id: string | null): id is string => !!id);

    const committed =
      courseIds.length > 0
        ? await commitSegmentPlans(supabase, {
            enrollmentId,
            userId: enrollment.user_id,
            programId: enrollment.program_id,
            courseIds,
            tier,
            preference: "standard",
            region,
            createdBy,
            acceptanceDate,
          })
        : await commitWholeProgramPlan(supabase, {
            enrollmentId,
            userId: enrollment.user_id,
            programId: enrollment.program_id,
            tier,
            preference: "standard",
            region,
            createdBy,
            acceptanceDate,
          });

    if (!committed.ok) {
      return { ok: false, plansCreated: 0, generated: 0, note: committed.error ?? "failed to create plan" };
    }

    const { data: plans } = await supabase
      .from("student_billing_plans")
      .select("id")
      .eq("enrollment_id", enrollmentId);
    const planIds: string[] = (plans ?? []).map((p: { id: string }) => p.id);
    if (planIds.length === 0) {
      return { ok: true, plansCreated: 0, generated: 0, note: "no pricing configured" };
    }

    // Generate any invoices already due to generate (the deposit).
    const gen = await generateDueInvoices(supabase, {
      asOf: new Date().toISOString().split("T")[0],
      dryRun: false,
      autoSend: true,
      planIds,
    });
    const generated = gen.invoices.filter(
      (i) => i.status === "sent" || i.status === "generated"
    ).length;

    return { ok: true, plansCreated: planIds.length, generated };
  } catch (err) {
    console.error("[setupProgramBillingOnAcceptance] failed", err);
    return {
      ok: false,
      plansCreated: 0,
      generated: 0,
      note: err instanceof Error ? err.message : "error",
    };
  }
}
