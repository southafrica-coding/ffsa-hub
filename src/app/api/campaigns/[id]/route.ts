import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  setCampaignLabels,
  setCampaignContacts,
} from "@/services/campaigns";
import {
  renderCampaignHtml,
  type CampaignBody,
} from "@/lib/campaigns/blocks";
import { getEffectiveBrand } from "@/services/brand";
import { getAuthedUser, canManageComms, COMMS_SEND_PERMS } from "@/lib/api-auth";
import { hasModuleAccess } from "@/lib/require-permission";
import type { Json } from "@/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/**
 * Who may read a campaign body. Same people as
 * requireModuleAccess(…, "communications") — super_admin, admin, or any
 * communications-module permission such as campaigns.read — plus the
 * comms_admin role, which canManageComms already treats as communications
 * access. requireModuleAccess itself redirects, so the route returns 403.
 */
async function canReadCampaign(supabase: Client, userId: string): Promise<boolean> {
  if (await hasModuleAccess(supabase, userId, "communications")) return true;
  return canManageComms(supabase, userId);
}

// Statuses the campaigns table accepts. PATCH may only move between draft
// and scheduled; sending/sent are written by send-now and the cron.
const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "cancelled",
] as const;

type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

function isCampaignStatus(value: unknown): value is CampaignStatus {
  return (
    typeof value === "string" &&
    (CAMPAIGN_STATUSES as readonly string[]).includes(value)
  );
}

function isAllowedStatusTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return (
    (from === "draft" && to === "scheduled") ||
    (from === "scheduled" && to === "draft")
  );
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta === tb;
}

// A real date-time. Date.parse("1") succeeds (it is a year), and Postgres
// rejects that string — which used to surface as a 500.
const SCHEDULED_AT_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function parseScheduledAt(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string" || !SCHEDULED_AT_RE.test(value)) return { ok: false };
  if (Number.isNaN(Date.parse(value))) return { ok: false };
  return { ok: true, value };
}

/** Fields the cron sends, or that choose who receives it. */
function editsScheduledSend(body: {
  name?: string;
  subject?: string;
  preview_text?: string | null;
  body_source?: CampaignBody;
  sending_identity_id?: string;
  label_ids?: string[];
  contact_ids?: string[];
}): boolean {
  return (
    body.name !== undefined ||
    body.subject !== undefined ||
    body.preview_text !== undefined ||
    body.body_source !== undefined ||
    body.sending_identity_id !== undefined ||
    Array.isArray(body.label_ids) ||
    Array.isArray(body.contact_ids)
  );
}

// Rows the cron has not taken over. A conditional update on these statuses
// loses the race if send-now or the cron has already moved the row to sending.
const EDITABLE_STATUSES = ["draft", "scheduled"] as const;

/**
 * `/api/cron/send-scheduled` sends a row when status is `scheduled` and
 * `scheduled_at <= now` (it also resumes `sending`, which PATCH cannot set).
 * Entering `scheduled`, or moving `scheduled_at` while already scheduled,
 * arms that query. Writing `scheduled_at` on a draft does not — cron ignores
 * it until status is scheduled. Clearing the timestamp (null) drops the row
 * out of the due query.
 */
function isScheduleAction(args: {
  fromStatus: string;
  toStatus: string;
  scheduledAtProvided: boolean;
  fromScheduledAt: string | null;
  toScheduledAt: string | null;
}): boolean {
  if (args.fromStatus !== "scheduled" && args.toStatus === "scheduled") return true;
  if (args.toStatus !== "scheduled" || !args.scheduledAtProvided) return false;
  if (args.toScheduledAt == null) return false;
  return !sameInstant(args.fromScheduledAt, args.toScheduledAt);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canReadCampaign(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await getCampaignById(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json({ campaign: data });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const existing = await getCampaignById(supabase, id);
  if (!existing.data) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (existing.data.status === "sent" || existing.data.status === "sending") {
    return NextResponse.json(
      { error: "A sent campaign can no longer be edited" },
      { status: 409 }
    );
  }

  let body: {
    name?: string;
    subject?: string;
    preview_text?: string | null;
    body_source?: CampaignBody;
    label_ids?: string[];
    /** Hand-picked contacts (migration 234) — the full set, replaced. */
    contact_ids?: string[];
    sending_identity_id?: string;
    scheduled_at?: string | null;
    status?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.status !== undefined) {
    if (!isCampaignStatus(body.status)) {
      return NextResponse.json({ error: "Unknown campaign status" }, { status: 400 });
    }
    if (!isAllowedStatusTransition(existing.data.status, body.status)) {
      return NextResponse.json(
        {
          error: `Cannot change campaign status from ${existing.data.status} to ${body.status}`,
        },
        { status: 400 }
      );
    }
  }

  let scheduledAt: string | null | undefined;
  if (body.scheduled_at !== undefined) {
    const parsed = parseScheduledAt(body.scheduled_at);
    if (!parsed.ok) {
      return NextResponse.json({ error: "Invalid scheduled_at" }, { status: 400 });
    }
    scheduledAt = parsed.value;
  }

  const toStatus = body.status ?? existing.data.status;
  const fromScheduledAt =
    typeof existing.data.scheduled_at === "string" ? existing.data.scheduled_at : null;
  const toScheduledAt = scheduledAt !== undefined ? scheduledAt : fromScheduledAt;
  const scheduling = isScheduleAction({
    fromStatus: existing.data.status,
    toStatus,
    scheduledAtProvided: scheduledAt !== undefined,
    fromScheduledAt,
    toScheduledAt,
  });
  // A scheduled row is already armed. Swapping subject, body, sender, or
  // audience does not change status, and the cron sends whatever is on the
  // row. That edit needs the same permission as send-now. Unscheduling back
  // to draft (status becomes draft, so the cron will not send) stays on the
  // manage/draft gate.
  const editingScheduled =
    existing.data.status === "scheduled" &&
    toStatus === "scheduled" &&
    editsScheduledSend(body);
  if (scheduling || editingScheduled) {
    if (!(await canManageComms(supabase, user.id, COMMS_SEND_PERMS))) {
      return NextResponse.json(
        {
          error: scheduling
            ? "Not authorized to schedule a send"
            : "Not authorized to edit a scheduled send",
        },
        { status: 403 }
      );
    }
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.subject !== undefined) patch.subject = body.subject;
  if (body.preview_text !== undefined) patch.preview_text = body.preview_text;
  if (body.sending_identity_id !== undefined)
    patch.sending_identity_id = body.sending_identity_id;
  if (scheduledAt !== undefined) patch.scheduled_at = scheduledAt;
  if (body.status !== undefined) patch.status = body.status;

  if (body.body_source !== undefined) {
    patch.body_source = body.body_source as unknown as Json;
    const identityId =
      body.sending_identity_id ?? existing.data.sending_identity_id ?? null;
    const brand = await getEffectiveBrand(supabase, identityId);
    patch.body_html = renderCampaignHtml(body.body_source, {
      previewText: body.preview_text ?? existing.data.preview_text ?? undefined,
      brand,
    });
  }

  const hasLabelIds = Array.isArray(body.label_ids);
  const hasContactIds = Array.isArray(body.contact_ids);
  if (Object.keys(patch).length === 0 && !hasLabelIds && !hasContactIds) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Always write through the status predicate, including an audience-only
  // change (patch is empty; updated_at still moves). Zero rows means the
  // campaign left draft/scheduled between the read and the write.
  const { data: updated, error } = await updateCampaign(supabase, id, patch, {
    onlyStatuses: EDITABLE_STATUSES,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) {
    return NextResponse.json(
      { error: "Campaign can no longer be edited" },
      { status: 409 }
    );
  }

  if (hasLabelIds) {
    const setRes = await setCampaignLabels(supabase, id, body.label_ids!);
    if (setRes.error) {
      return NextResponse.json({ error: setRes.error.message }, { status: 500 });
    }
  }

  if (hasContactIds) {
    const setRes = await setCampaignContacts(supabase, id, body.contact_ids!, user.id);
    if (setRes.error) {
      return NextResponse.json({ error: setRes.error.message }, { status: 500 });
    }
  }

  const refreshed = await getCampaignById(supabase, id);
  return NextResponse.json({ campaign: refreshed.data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const existing = await getCampaignById(supabase, id);
  if (!existing.data) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  // Deleting a scheduled campaign drops a send the cron would otherwise
  // make. Same permission as scheduling it.
  if (existing.data.status === "scheduled") {
    if (!(await canManageComms(supabase, user.id, COMMS_SEND_PERMS))) {
      return NextResponse.json(
        { error: "Not authorized to delete a scheduled send" },
        { status: 403 }
      );
    }
  }

  const { data: deleted, error } = await deleteCampaign(supabase, id, {
    onlyStatuses: [existing.data.status],
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted) {
    return NextResponse.json(
      { error: "Campaign can no longer be edited" },
      { status: 409 }
    );
  }
  return NextResponse.json({ deleted: true });
}
