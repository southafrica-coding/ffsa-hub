import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateEvent } from "@/services/events";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, EVENT_UPDATE_GATE, writeBlocked } from "@/lib/auth/event-access";
import { setEventLabels } from "@/services/event-labels";
import { listFinanceOrgChoices } from "@/lib/finance/orgs";

// PATCH /api/events/[id] — update event-level CRM fields (base label, etc.)
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, EVENT_UPDATE_GATE.keys, id, EVENT_UPDATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: {
    base_label_id?: string | null;
    base_label_ids?: string[];
    status?: string;
    title?: string;
    description?: string | null;
    location?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    max_capacity?: number | null;
    is_public?: boolean;
    registration_required?: boolean;
    brand?: string;
    cancellation_message?: string | null;
    finance_org_id?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  // CRM labels (migration 193). base_label_ids is the full set; the
  // first entry becomes the primary base_label_id. base_label_id on its
  // own is still accepted and means "a set of one".
  if ("base_label_ids" in body) {
    const ids = body.base_label_ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return NextResponse.json(
        { error: "base_label_ids must be an array of label ids" },
        { status: 400 }
      );
    }
    const { error: labelErr } = await setEventLabels(supabase, id, ids);
    if (labelErr) {
      return NextResponse.json({ error: labelErr }, { status: 500 });
    }
  } else if ("base_label_id" in body) {
    const { error: labelErr } = await setEventLabels(
      supabase,
      id,
      body.base_label_id ? [body.base_label_id] : []
    );
    if (labelErr) {
      return NextResponse.json({ error: labelErr }, { status: 500 });
    }
  }

  // Lifecycle status.
  if ("status" in body) {
    const allowed = ["draft", "published", "cancelled", "completed"];
    if (!allowed.includes(body.status as string)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status;
  }

  // Cancellation message (migration 139) — buyer-facing note shown on the
  // public event page while cancelled and in ticket refund emails. Empty
  // string clears it.
  if ("cancellation_message" in body)
    patch.cancellation_message = body.cancellation_message?.trim() || null;

  // Core event details — editable from the event page.
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;
  if ("title" in body) {
    const title = (body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    patch.title = title;
  }
  if ("description" in body)
    patch.description = body.description?.trim() || null;
  if ("location" in body) patch.location = body.location?.trim() || null;
  if ("start_date" in body) {
    if (!body.start_date || !dateRe.test(body.start_date)) {
      return NextResponse.json(
        { error: "Start date must be a valid date (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    patch.start_date = body.start_date;
  }
  if ("end_date" in body) {
    if (body.end_date && !dateRe.test(body.end_date)) {
      return NextResponse.json({ error: "Invalid end date" }, { status: 400 });
    }
    patch.end_date = body.end_date || null;
  }
  if ("start_time" in body) {
    if (body.start_time && !timeRe.test(body.start_time)) {
      return NextResponse.json({ error: "Invalid start time" }, { status: 400 });
    }
    patch.start_time = body.start_time || null;
  }
  if ("end_time" in body) {
    if (body.end_time && !timeRe.test(body.end_time)) {
      return NextResponse.json({ error: "Invalid end time" }, { status: 400 });
    }
    patch.end_time = body.end_time || null;
  }
  if ("max_capacity" in body) {
    const cap = body.max_capacity;
    if (cap != null && (!Number.isInteger(cap) || cap < 0)) {
      return NextResponse.json(
        { error: "Capacity must be a whole number" },
        { status: 400 }
      );
    }
    patch.max_capacity = cap ?? null;
  }
  if ("is_public" in body) patch.is_public = !!body.is_public;
  if ("registration_required" in body)
    patch.registration_required = !!body.registration_required;

  // Visual brand for every email tied to this event. Drives the
  // template router used by workflow steps, ticket confirmations,
  // and (future) other event-tied sends. Migration 077.
  if ("brand" in body) {
    const allowedBrands = ["ff", "the_send", "ffsa_camps", "preachers", "wild_ones", "missio"];
    if (!allowedBrands.includes(body.brand as string)) {
      return NextResponse.json({ error: "Invalid brand" }, { status: 400 });
    }
    patch.brand = body.brand;
  }

  // Finance organisation (migrations 290, 291): which Xero file this event's
  // money is recorded in. One of the two orgs, or null for "not chosen yet".
  // Never filled in from the currency.
  if ("finance_org_id" in body) {
    const orgId = body.finance_org_id;
    if (orgId === null || orgId === "") {
      patch.finance_org_id = null;
    } else {
      const { data: orgs } = await listFinanceOrgChoices(supabase);
      const known = Array.isArray(orgs) && orgs.some((o: { id: string }) => o.id === orgId);
      if (typeof orgId !== "string" || !known) {
        return NextResponse.json({ error: "Unknown finance organisation" }, { status: 400 });
      }
      patch.finance_org_id = orgId;
    }
  }

  if (Object.keys(patch).length === 0) {
    // A labels-only PATCH is complete once setEventLabels has run.
    if ("base_label_ids" in body || "base_label_id" in body) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "No patchable fields provided" }, { status: 400 });
  }

  const { data, error } = await updateEvent(supabase, id, patch);
  if (writeBlocked(error, data)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
