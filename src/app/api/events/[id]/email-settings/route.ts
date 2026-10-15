import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { createAuditLog } from "@/services/audit";
import { resolveEventBrand } from "@/lib/ticketing/fulfillment";
import { resolveEventSender } from "@/lib/email/event-sender";
import {
  VERIFIED_SENDING_DOMAINS,
  createSendingIdentity,
  ensureUniqueSlug,
  forwardListError,
  normalizeForwardList,
  updateSendingIdentity,
} from "@/services/sending-identities";

// /api/events/[id]/email-settings — the event's Emails tab (migration 241).
//
// GET    → the event's sender (its own, else the brand's), the senders it
//          could pick, the verified From domains, and its logo setting.
// PATCH  → { sending_identity_id?: string | null, email_show_event_logo?: boolean }
// POST   → { from_name, from_local, from_domain, forward_to[] } — make a
//          sender for this event and switch the event to it. Its Hub reply
//          address is <slug>@ffsahub.com.
// PUT    → { from_name, from_local, from_domain, forward_to[] } — edit the
//          event's sender. Only one used by this event alone: a brand or
//          shared sender is edited under Communications → Identities, so
//          one event can't quietly change another's emails.

const HUB_INBOX_DOMAIN = "ffsahub.com";
const DEFAULT_FORWARD = ["media@ffsouthafrica.com"];

// forward_to / reply_from_email (migrations 228-229) and the event's email
// columns (241) aren't all in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

async function guard(eventId: string) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await canManageEvents(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  const admin: Admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, title, brand, public_slug, logo_url, sending_identity_id, email_show_event_logo")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { error: NextResponse.json({ error: "Event not found" }, { status: 404 }) };
  return { supabase, admin, user, event };
}

/** How many events use this sender — editing is only allowed when it's just this one. */
async function eventsUsing(admin: Admin, identityId: string) {
  const { count } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("sending_identity_id", identityId);
  return count ?? 0;
}

function fromAddress(b: { from_local?: unknown; from_domain?: unknown }): string | { error: string } {
  const local = typeof b.from_local === "string" ? b.from_local.trim().toLowerCase() : "";
  const domain = typeof b.from_domain === "string" ? b.from_domain.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/.test(local)) return { error: "The From address needs a name before the @ (letters, numbers, dots or dashes)." };
  if (!VERIFIED_SENDING_DOMAINS.includes(domain)) {
    return { error: `Send from a verified domain: ${VERIFIED_SENDING_DOMAINS.join(" or ")}.` };
  }
  return `${local}@${domain}`;
}

function forwardList(raw: unknown): string[] | { error: string } {
  const list = normalizeForwardList(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  if (list.length === 0) return { error: "Forward replies to at least one inbox." };
  const err = forwardListError(list);
  return err ? { error: err } : list;
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const { admin, event } = g;

  const brand = resolveEventBrand(event);
  const brandSender = await resolveEventSender(admin, { ...event, sending_identity_id: null }, brand);
  const { data: identities } = await admin
    .from("sending_identities")
    .select("id, slug, display_name, from_name, from_email, reply_to, forward_to")
    .eq("is_active", true)
    .order("display_name");

  const current = event.sending_identity_id
    ? (identities ?? []).find((i: { id: string }) => i.id === event.sending_identity_id) ?? null
    : null;
  const brandIdentity = brandSender.identityId
    ? (identities ?? []).find((i: { id: string }) => i.id === brandSender.identityId) ?? null
    : null;

  return NextResponse.json({
    event: {
      title: event.title,
      brand,
      logo_url: event.logo_url,
      email_show_event_logo: event.email_show_event_logo,
      sending_identity_id: event.sending_identity_id,
    },
    brand_sender: brandIdentity ?? {
      id: null,
      display_name: "Default",
      from_name: brandSender.fromName,
      from_email: brandSender.fromEmail,
      reply_to: brandSender.replyTo,
      forward_to: [],
    },
    current,
    // Editable here only when no other event uses it and it isn't the brand's.
    current_editable:
      !!current && current.id !== brandSender.identityId && (await eventsUsing(admin, current.id)) <= 1,
    identities: identities ?? [],
    domains: VERIFIED_SENDING_DOMAINS,
    default_forward: DEFAULT_FORWARD,
    hub_inbox_domain: HUB_INBOX_DOMAIN,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const { supabase, admin } = g;
  const b = (await request.json().catch(() => ({}))) as {
    sending_identity_id?: string | null;
    email_show_event_logo?: boolean;
  };
  const patch: Record<string, unknown> = {};
  if (b.sending_identity_id !== undefined) {
    if (b.sending_identity_id !== null) {
      const { data: ok } = await admin
        .from("sending_identities")
        .select("id")
        .eq("id", b.sending_identity_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!ok) return NextResponse.json({ error: "That sender isn't available." }, { status: 400 });
    }
    patch.sending_identity_id = b.sending_identity_id;
  }
  if (typeof b.email_show_event_logo === "boolean") patch.email_show_event_logo = b.email_show_event_logo;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error } = await admin.from("events").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await createAuditLog(supabase, { action: "events.email_settings", resource_type: "event", resource_id: id, changes: patch });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const { supabase, admin, event } = g;
  const b = await request.json().catch(() => ({}));

  const fromName = typeof b.from_name === "string" ? b.from_name.trim().slice(0, 80) : "";
  if (!fromName) return NextResponse.json({ error: "Give the sender a name." }, { status: 400 });
  const from = fromAddress(b);
  if (typeof from !== "string") return NextResponse.json(from, { status: 400 });
  const forward = forwardList(b.forward_to);
  if (!Array.isArray(forward)) return NextResponse.json(forward, { status: 400 });

  // The reply address is the identity's slug at the Hub's own domain, so a
  // reply lands in the Hub (on the buyer's record) and is forwarded on.
  const slug = await ensureUniqueSlug(admin, event.public_slug || fromName);
  const { data: base } = await admin
    .from("sending_identities")
    .select("reply_from_email")
    .eq("slug", "events")
    .maybeSingle();
  const { data: identity, error } = await createSendingIdentity(admin, {
    slug,
    display_name: fromName,
    from_name: fromName,
    from_email: from,
    reply_to: `${slug}@${HUB_INBOX_DOMAIN}`,
    forward_to: forward,
    reply_from_email: base?.reply_from_email ?? null,
    provider: "resend",
  });
  if (error || !identity) return NextResponse.json({ error: error?.message ?? "Couldn't create the sender" }, { status: 500 });

  const { error: evErr } = await admin.from("events").update({ sending_identity_id: identity.id }).eq("id", id);
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
  await createAuditLog(supabase, {
    action: "events.email_sender_created",
    resource_type: "event",
    resource_id: id,
    changes: { identity_id: identity.id, from_name: fromName, from_email: from, reply_to: identity.reply_to, forward_to: forward },
  });
  return NextResponse.json({ ok: true, identity });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const { supabase, admin, event } = g;
  if (!event.sending_identity_id) {
    return NextResponse.json({ error: "This event uses its brand's sender — make its own first." }, { status: 400 });
  }
  if ((await eventsUsing(admin, event.sending_identity_id)) > 1) {
    return NextResponse.json(
      { error: "Other events use this sender too — edit it under Communications → Identities." },
      { status: 409 }
    );
  }
  const b = await request.json().catch(() => ({}));
  const fromName = typeof b.from_name === "string" ? b.from_name.trim().slice(0, 80) : "";
  if (!fromName) return NextResponse.json({ error: "Give the sender a name." }, { status: 400 });
  const from = fromAddress(b);
  if (typeof from !== "string") return NextResponse.json(from, { status: 400 });
  const forward = forwardList(b.forward_to);
  if (!Array.isArray(forward)) return NextResponse.json(forward, { status: 400 });

  const { error } = await updateSendingIdentity(admin, event.sending_identity_id, {
    display_name: fromName,
    from_name: fromName,
    from_email: from,
    forward_to: forward,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await createAuditLog(supabase, {
    action: "events.email_sender_updated",
    resource_type: "event",
    resource_id: id,
    changes: { identity_id: event.sending_identity_id, from_name: fromName, from_email: from, forward_to: forward },
  });
  return NextResponse.json({ ok: true });
}
