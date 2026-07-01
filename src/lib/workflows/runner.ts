// ============================================================
// Workflow runner — advances a single enrollment.
// ============================================================
// Called two ways:
//   1. inline from the form-submit hook, right after enrollment,
//      so the first email goes out instantly; and
//   2. from the run-workflows cron, for enrollments whose delay
//      has elapsed (next_run_at <= now).
//
// One call drains all consecutive INSTANT steps (send_email,
// assign_label) and stops at the first delay (parking the
// enrollment via next_run_at) or at the end (status=completed).
// Always invoked with a service-role admin client (bypasses RLS).
// ============================================================

import { addLabelToContact } from "@/services/labels";
import {
  createSchedulingRequest,
  getActiveSchedulingForEnrollment,
} from "@/services/scheduling";
import { logActivity, logLabelAdded } from "@/services/activity-events";
import {
  getWorkflowSteps,
  updateEnrollment,
  recordStepRun,
} from "@/services/workflows";
import { sendViaMailtrap } from "@/lib/email/mailtrap";
import { renderCampaignText, type CampaignBody } from "@/lib/campaigns/blocks";
import { renderWorkflowEmail, type WorkflowEmailBrand } from "@/lib/email/workflow-template";
import { signPrefsToken } from "@/lib/tokens/unsubscribe";
import { substituteFirstName, escapeHtml } from "@/lib/email/placeholders";
import type {
  AssignLabelConfig,
  DelayConfig,
  SendEmailConfig,
} from "@/lib/workflows/types";
import type { Json } from "@/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com";

export type Enrollment = {
  id: string;
  workflow_id: string;
  contact_id: string;
  current_step: number;
  status: string;
};

export type TickResult = {
  enrollmentId: string;
  stepsRun: number;
  status: "active" | "completed" | "cancelled";
  emailsSent: number;
};

type IdentityRow = {
  id: string;
  from_email: string;
  from_name: string;
  reply_to: string | null;
};

type ContactRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  marketing_status: string | null;
};

type StepRow = { id: string; step_type: string; config: unknown };

// ── Email helpers (mirror src/services/campaign-send.ts) ─────

function prefsUrlFor(contactId: string): string {
  // Workflows carry no campaign id; the preferences page shows all labels.
  const token = signPrefsToken(contactId, null);
  return `${APP_URL}/preferences?t=${encodeURIComponent(token)}`;
}

function deliverabilityHeaders(args: {
  prefsUrl: string;
  workflowId: string;
  fromEmail: string;
  contactId: string;
}): Record<string, string> {
  // These are 1:1, user-triggered first-touch emails. Keep one-click
  // unsubscribe (good signal + compliant), but do NOT brand them as a bulk
  // mailing list — Precedence:bulk + List-ID push Gmail toward the Promotions
  // tab and read as marketing to the filters.
  return {
    "List-Unsubscribe": `<${args.prefsUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "X-Entity-Ref-ID": `workflow-${args.workflowId}:${args.contactId}`,
  };
}

// A distinct, body-derived preheader (the hidden inbox-preview text). Falls
// back to the subject only when the body has no text. A preheader that just
// duplicates the subject is a wasted/penalized signal.
function derivePreheader(plainText: string, fallback: string): string {
  const cleaned = plainText.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.length > 110 ? `${cleaned.slice(0, 108)}…` : cleaned;
}

async function recordStep(
  supabase: Client,
  enrollmentId: string,
  stepId: string,
  status: "done" | "failed" | "skipped",
  detail: Record<string, unknown>
): Promise<void> {
  await recordStepRun(supabase, {
    enrollment_id: enrollmentId,
    step_id: stepId,
    status,
    detail: detail as Json,
  });
}

// ── Identity resolution ──────────────────────────────────────
// Sender priority: step override → outcome label's identity →
// first active identity (prefer the seeded 'default-marketing').

async function resolveFallbackIdentity(supabase: Client): Promise<IdentityRow | null> {
  const { data } = await supabase
    .from("sending_identities")
    .select("id, from_email, from_name, reply_to, slug")
    .eq("is_active", true)
    .order("slug")
    .limit(50);
  const rows = (data ?? []) as Array<IdentityRow & { slug: string }>;
  return rows.find((r) => r.slug === "default-marketing") ?? rows[0] ?? null;
}

async function getIdentityById(
  supabase: Client,
  id: string
): Promise<IdentityRow | null> {
  const { data } = await supabase
    .from("sending_identities")
    .select("id, from_email, from_name, reply_to")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as IdentityRow | null;
}

async function loadWorkflowIdentity(
  supabase: Client,
  workflowId: string
): Promise<{
  labelId: string | null;
  identity: IdentityRow | null;
  createdBy: string | null;
  /** Event brand (from outcome_workflows → event_outcomes → events.brand). */
  brand: WorkflowEmailBrand;
}> {
  const { data } = await supabase
    .from("outcome_workflows")
    .select(
      "id, created_by, event_outcomes(label_id, events(brand), labels(id, sending_identity_id, sending_identities(id, from_email, from_name, reply_to)))"
    )
    .eq("id", workflowId)
    .maybeSingle();

  const outcome = data?.event_outcomes ?? null;
  const label = outcome?.labels ?? null;
  const identity = (label?.sending_identities ?? null) as IdentityRow | null;
  const rawBrand = (outcome?.events?.brand as string | null | undefined) ?? "ff";
  const brand: WorkflowEmailBrand =
    rawBrand === "the_send"
      ? "the_send"
      : rawBrand === "ffsa_camps"
        ? "ffsa_camps"
        : rawBrand === "preachers"
          ? "preachers"
          : "ff";
  return {
    labelId: label?.id ?? null,
    identity,
    createdBy: (data?.created_by as string | null) ?? null,
    brand,
  };
}

// Fallback requester for an auto-created scheduling request when the workflow
// has no created_by — scheduling_requests.requested_by is NOT NULL.
async function resolveRequesterId(supabase: Client): Promise<string | null> {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// ── Public entry ─────────────────────────────────────────────

export async function runEnrollment(
  supabase: Client,
  enrollment: Enrollment
): Promise<TickResult> {
  const result: TickResult = {
    enrollmentId: enrollment.id,
    stepsRun: 0,
    status: "active",
    emailsSent: 0,
  };

  if (enrollment.status !== "active") {
    result.status = enrollment.status as TickResult["status"];
    return result;
  }

  // Load the contact once. Respect global opt-out: cancel the run.
  const { data: contactData } = await supabase
    .from("contacts")
    .select("id, email, first_name, last_name, preferred_name, marketing_status")
    .eq("id", enrollment.contact_id)
    .maybeSingle();
  const contact = contactData as ContactRow | null;

  if (!contact) {
    await markCancelled(supabase, enrollment.id);
    result.status = "cancelled";
    return result;
  }
  if (contact.marketing_status === "unsubscribed_all") {
    await markCancelled(supabase, enrollment.id);
    await logActivity(supabase, {
      contact_id: contact.id,
      event_type: "workflow_cancelled",
      payload: { workflow_id: enrollment.workflow_id, reason: "globally_unsubscribed" },
    });
    result.status = "cancelled";
    return result;
  }

  // Ordered steps + the outcome label's sending identity (sender fallback).
  const [{ data: steps }, identityCtx] = await Promise.all([
    getWorkflowSteps(supabase, enrollment.workflow_id),
    loadWorkflowIdentity(supabase, enrollment.workflow_id),
  ]);
  const stepList = (steps ?? []) as StepRow[];

  const identityCache = new Map<string, IdentityRow | null>();
  let fallbackIdentity: IdentityRow | null | undefined;
  const getFallback = async () => {
    if (fallbackIdentity === undefined) {
      fallbackIdentity = await resolveFallbackIdentity(supabase);
    }
    return fallbackIdentity;
  };

  let idx = enrollment.current_step;

  // Drain consecutive instant steps; pause on delay; complete at end.
  // Bounded by stepList.length to rule out any accidental infinite loop.
  for (let guard = 0; guard <= stepList.length; guard++) {
    if (idx >= stepList.length) {
      await updateEnrollment(supabase, enrollment.id, {
        status: "completed",
        next_run_at: null,
        completed_at: new Date().toISOString(),
        current_step: idx,
      });
      await logActivity(supabase, {
        contact_id: contact.id,
        event_type: "workflow_completed",
        payload: { workflow_id: enrollment.workflow_id },
      });
      result.status = "completed";
      return result;
    }

    const step = stepList[idx];

    // Delay: park the enrollment for the cron to resume later.
    if (step.step_type === "delay") {
      const days = Math.max(0, Number((step.config as DelayConfig)?.days ?? 0));
      const resumeAt = new Date(Date.now() + days * 86_400_000).toISOString();
      await updateEnrollment(supabase, enrollment.id, {
        current_step: idx + 1,
        next_run_at: resumeAt,
      });
      await recordStep(supabase, enrollment.id, step.id, "done", {
        type: "delay",
        days,
        resumes_at: resumeAt,
      });
      result.status = "active";
      return result;
    }

    // Instant steps.
    try {
      if (step.step_type === "send_email") {
        const sent = await runEmailStep(supabase, {
          enrollmentId: enrollment.id,
          step,
          cfg: step.config as SendEmailConfig,
          contact,
          workflowId: enrollment.workflow_id,
          outcomeLabelId: identityCtx.labelId,
          labelIdentity: identityCtx.identity,
          workflowCreatedBy: identityCtx.createdBy,
          brand: identityCtx.brand,
          identityCache,
          getFallback,
        });
        if (sent) result.emailsSent++;
      } else if (step.step_type === "assign_label") {
        await runAssignLabelStep(supabase, {
          enrollmentId: enrollment.id,
          step,
          cfg: step.config as AssignLabelConfig,
          contactId: contact.id,
          workflowId: enrollment.workflow_id,
        });
      } else {
        await recordStep(supabase, enrollment.id, step.id, "skipped", {
          reason: `unknown_step_type:${step.step_type}`,
        });
      }
    } catch (e) {
      await recordStep(supabase, enrollment.id, step.id, "failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    result.stepsRun++;
    idx += 1;
    await updateEnrollment(supabase, enrollment.id, { current_step: idx });
  }

  return result;
}

// ── Step implementations ─────────────────────────────────────

async function runEmailStep(
  supabase: Client,
  args: {
    enrollmentId: string;
    step: StepRow;
    cfg: SendEmailConfig;
    contact: ContactRow;
    workflowId: string;
    outcomeLabelId: string | null;
    labelIdentity: IdentityRow | null;
    workflowCreatedBy: string | null;
    /** Event brand resolved once up-front so every email step shares it. */
    brand: WorkflowEmailBrand;
    identityCache: Map<string, IdentityRow | null>;
    getFallback: () => Promise<IdentityRow | null>;
  }
): Promise<boolean> {
  const { enrollmentId, step, cfg, contact, workflowId } = args;

  if (!contact.email) {
    await recordStep(supabase, enrollmentId, step.id, "skipped", { reason: "no_email" });
    return false;
  }

  // Resolve sender.
  let identity: IdentityRow | null = args.labelIdentity;
  const overrideId = cfg?.sending_identity_id ?? null;
  if (overrideId) {
    if (!args.identityCache.has(overrideId)) {
      args.identityCache.set(overrideId, await getIdentityById(supabase, overrideId));
    }
    identity = args.identityCache.get(overrideId) ?? null;
  }
  if (!identity) identity = await args.getFallback();
  if (!identity) {
    await recordStep(supabase, enrollmentId, step.id, "failed", {
      reason: "no_sending_identity",
    });
    return false;
  }

  const prefsUrl = prefsUrlFor(contact.id);
  const body = (cfg?.body ?? { blocks: [] }) as unknown as CampaignBody;

  // Personalize: {{first_name}} / [First Name] / [Name] → the contact's name.
  // Prefer their preferred name; fall back to first name, then a neutral
  // "there". Escaped when spliced into HTML; raw for subject + plain text.
  const firstName =
    contact.preferred_name?.trim() || contact.first_name?.trim() || "there";
  const subject = substituteFirstName(
    cfg?.subject?.trim() || "A message from Fire & Fragrance",
    firstName
  );

  // Optional availability scheduler. Reuse an open request for this enrollment,
  // else create one WITHOUT a standalone email (the button lives in this
  // email). Proposed times land on the contact's Event Follow-up profile.
  let scheduler: { url: string; label: string } | undefined;
  if (cfg?.scheduler?.enabled) {
    const sc = cfg.scheduler;
    let token: string | null = null;
    const existing = await getActiveSchedulingForEnrollment(supabase, enrollmentId);
    if (existing) {
      token = existing.magic_token;
    } else {
      const requestedBy =
        args.workflowCreatedBy ?? (await resolveRequesterId(supabase));
      if (requestedBy) {
        const r = await createSchedulingRequest(supabase, {
          contactId: contact.id,
          requestedBy,
          enrollmentId,
          durationMinutes: sc.durationMinutes,
          expiryDays: sc.windowDays,
          sendEmail: false,
        });
        if (!("error" in r)) token = r.request.magic_token;
      }
    }
    if (token) {
      scheduler = {
        url: `${APP_URL}/schedule/${token}`,
        label: sc.buttonText?.trim() || "Choose a time that works",
      };
    }
  }

  // Render inside the brand-appropriate workflow shell. The block
  // content is the only variable part — F&F vs THE SEND swaps the
  // outer chrome and the per-block styling.
  // Plain-text body first, so the preheader can be derived from real content
  // rather than echoing the subject line.
  const text = substituteFirstName(renderCampaignText(body, {}), firstName);
  const html = substituteFirstName(
    renderWorkflowEmail(body, {
      baseUrl: APP_URL,
      prefsUrl,
      previewText: derivePreheader(text, subject),
      scheduler,
      brand: args.brand,
    }),
    escapeHtml(firstName)
  );

  const res = await sendViaMailtrap({
    fromEmail: identity.from_email,
    fromName: identity.from_name,
    replyTo: identity.reply_to,
    to: contact.email,
    subject,
    html,
    text: `${text}\n\n———\nManage email preferences: ${prefsUrl}`,
    category: `workflow:${workflowId}`,
    headers: deliverabilityHeaders({
      prefsUrl,
      workflowId,
      fromEmail: identity.from_email,
      contactId: contact.id,
    }),
  });

  if (res.error) {
    await recordStep(supabase, enrollmentId, step.id, "failed", {
      error: res.error.slice(0, 300),
    });
    return false;
  }

  await recordStep(supabase, enrollmentId, step.id, "done", {
    type: "send_email",
    message_id: res.messageId,
    subject,
  });
  await logActivity(supabase, {
    contact_id: contact.id,
    event_type: "workflow_email_sent",
    related_label_id: args.outcomeLabelId,
    occurred_at: new Date().toISOString(),
    payload: { workflow_id: workflowId, step_id: step.id, subject },
  });

  // Record the send for delivery/open/click analytics. The Mailtrap webhook
  // reconciles by provider_message_id, mirroring campaign_recipients.
  await supabase.from("workflow_email_sends").insert({
    enrollment_id: enrollmentId,
    workflow_id: workflowId,
    step_id: step.id,
    contact_id: contact.id,
    outcome_label_id: args.outcomeLabelId,
    provider_message_id: res.messageId,
    sent_at: new Date().toISOString(),
  });
  return true;
}

async function runAssignLabelStep(
  supabase: Client,
  args: {
    enrollmentId: string;
    step: StepRow;
    cfg: AssignLabelConfig;
    contactId: string;
    workflowId: string;
  }
): Promise<void> {
  // Read multi-label list, falling back to the legacy single-label shape
  // for workflows saved before multi-label support landed.
  const labelIds = Array.isArray(args.cfg?.label_ids)
    ? args.cfg.label_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : args.cfg?.label_id
      ? [args.cfg.label_id]
      : [];

  if (labelIds.length === 0) {
    await recordStep(supabase, args.enrollmentId, args.step.id, "skipped", {
      reason: "no_label_id",
    });
    return;
  }

  const applied: string[] = [];
  for (const labelId of labelIds) {
    const added = await addLabelToContact(supabase, {
      contact_id: args.contactId,
      label_id: labelId,
      added_via: `workflow:${args.workflowId}`,
      added_by: null,
    });
    if (added.data) {
      await logLabelAdded(supabase, {
        contactId: args.contactId,
        labelId,
        addedVia: `workflow:${args.workflowId}`,
        userId: null,
      });
    }
    applied.push(labelId);
  }

  await recordStep(supabase, args.enrollmentId, args.step.id, "done", {
    type: "assign_label",
    label_ids: applied,
  });
}

// ── Small helpers ────────────────────────────────────────────

async function markCancelled(supabase: Client, enrollmentId: string): Promise<void> {
  await updateEnrollment(supabase, enrollmentId, {
    status: "cancelled",
    next_run_at: null,
    completed_at: new Date().toISOString(),
  });
}
