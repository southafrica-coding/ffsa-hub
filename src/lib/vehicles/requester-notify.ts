// Vehicles → the person who booked (migration 239).
//
// Every confirmation and update about a booking goes straight to its
// requester as a Slack DM, alongside an email (public requesters and anyone
// not linked to Slack still hear about it). A vehicle manager can also write
// the requester a message from the booking page — that one goes from the
// manager's OWN Slack account (migration 240, "Connect my Slack"), so the
// requester replies to them directly; the Hub reads that DM back onto the
// booking. Email only when the requester isn't on Slack.
//
// Each send is logged in vehicle_booking_messages so the booking page shows
// exactly what the requester was told, and how.
//
// Best-effort throughout: nothing here may fail the action that triggered it.

import * as slack from "@/lib/slack/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateRangeLabel } from "@/lib/bookings/dates";
import { sendTransactional } from "@/lib/email/send-transactional";
import { vehicleRequestDecisionEmailHtml } from "@/lib/email/templates/vehicle-request-decision";
import {
  vehicleRequesterUpdateEmailHtml,
  vehicleRequesterUpdateSubject,
  type RequesterUpdateKind,
} from "@/lib/email/templates/vehicle-requester-update";
import { dayCount } from "@/services/vehicles";
import { getSlackUserToken, hasAllScopes } from "@/lib/slack/user-tokens";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type RequesterNoticeKind = RequesterUpdateKind | "approved" | "denied";

const SITE = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://www.ffsahub.com"
).replace(/\/$/, "");
const bookingUrl = (id: string) => `${SITE}/bookings/vehicles/${id}`;

type Booking = {
  id: string;
  booking_name: string;
  requester_name: string | null;
  requester_email: string | null;
  requested_by: string | null;
  checkout_date: string;
  return_date: string;
  assignments: { vehicle: { name: string; registration_plate: string | null } | null }[] | null;
};

function firstNameOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "there";
}

function vehicleLabelOf(b: Booking): string | null {
  const names = (b.assignments ?? [])
    .map((a) => a.vehicle)
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => (v.registration_plate ? `${v.name} (${v.registration_plate})` : v.name));
  return names.length ? names.join(", ") : null;
}

/**
 * The requester's Slack member id: their linked Hub account first, then a Hub
 * account with the same email (public-form requesters who are staff), then a
 * straight Slack lookup by email.
 */
async function requesterSlackId(admin: Client, b: Booking): Promise<string | null> {
  if (b.requested_by) {
    const { data } = await admin
      .from("users")
      .select("slack_user_id")
      .eq("id", b.requested_by)
      .maybeSingle();
    if (data?.slack_user_id) return data.slack_user_id as string;
  }
  const email = (b.requester_email ?? "").trim();
  if (!email) return null;
  const { data: byEmail } = await admin
    .from("users")
    .select("slack_user_id")
    .ilike("email", email)
    .not("slack_user_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (byEmail?.slack_user_id) return byEmail.slack_user_id as string;
  try {
    const res = await slack.lookupUserByEmail(email);
    return res.ok && res.user?.id ? res.user.id : null;
  } catch {
    return null;
  }
}

async function senderOf(
  admin: Client,
  userId: string | null | undefined
): Promise<{ name: string | null; slackUserId: string | null }> {
  if (!userId) return { name: null, slackUserId: null };
  const { data } = await admin
    .from("users")
    .select("first_name, last_name, preferred_name, slack_user_id")
    .eq("id", userId)
    .maybeSingle();
  const first = (data?.preferred_name || data?.first_name || "").trim();
  const name = [first, (data?.last_name ?? "").trim()].filter(Boolean).join(" ") || null;
  return { name, slackUserId: (data?.slack_user_id as string | null) ?? null };
}

// ── Slack copy ──────────────────────────────────────────────

const TITLES: Record<RequesterNoticeKind, string> = {
  submitted: "📝 Request received",
  approved: "✅ Approved",
  denied: "❌ Not approved",
  reopened: "↩️ Back to pending",
  changed: "✏️ Booking updated",
  cancelled: "🚫 Cancelled",
  completed: "🏁 Completed",
  message: "💬 Message about your booking",
};

function slackMessage(
  kind: RequesterNoticeKind,
  b: Booking,
  opts: { note: string | null; changes: string[]; sender: { name: string | null; slackUserId: string | null } }
) {
  const days = dayCount(b.checkout_date, b.return_date);
  const when = `${dateRangeLabel(b.checkout_date, b.return_date)} (${days} day${days === 1 ? "" : "s"})`;
  const vehicle = vehicleLabelOf(b);
  const who = opts.sender.slackUserId
    ? `<@${opts.sender.slackUserId}>`
    : opts.sender.name ?? "The Vehicle Coordinator";

  const lines: string[] = [];
  switch (kind) {
    case "submitted":
      lines.push("Thanks — your request is in. The Vehicle Coordinator will confirm it shortly.");
      break;
    case "approved":
      lines.push("Your vehicle booking is confirmed. The coordinator will be in touch about collection.");
      break;
    case "denied":
      lines.push("We're not able to approve this one. If your dates are flexible, reply to the coordinator and we'll see what's possible.");
      break;
    case "reopened":
      lines.push("Your booking has been moved *back to pending* while a few details are confirmed. It isn't confirmed until it's approved again — you'll get a message here when it is.");
      break;
    case "changed":
      lines.push("The Vehicle Coordinator made some changes:");
      for (const c of opts.changes) lines.push(`• ${c}`);
      break;
    case "cancelled":
      lines.push("This booking has been cancelled.");
      break;
    case "completed":
      lines.push("All done — thanks for looking after the vehicle.");
      break;
    case "message":
      lines.push(`*From ${who}:*`);
      lines.push(opts.note ?? "");
      break;
  }
  if (opts.note && kind !== "message") lines.push(`*Note from the coordinator:* ${opts.note}`);

  const facts = [when, vehicle && kind !== "message" ? `🚐 ${vehicle}` : null].filter(Boolean).join(" · ");

  const blocks: Record<string, unknown>[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${TITLES[kind]} — ${b.booking_name}*\n${facts}` } },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];
  if (kind === "message" || kind === "reopened" || kind === "denied") {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: opts.sender.slackUserId
            ? `To reply, message <@${opts.sender.slackUserId}> directly — replies to this bot don't reach the coordinator.`
            : "To reply, message the Vehicle Coordinator directly — replies to this bot don't reach them.",
        },
      ],
    });
  }
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", action_id: "vh_open", text: { type: "plain_text", text: "Open in Hub" }, url: bookingUrl(b.id) },
    ],
  });

  return { text: `${TITLES[kind]} — ${b.booking_name}`, blocks };
}

// ── entry point ─────────────────────────────────────────────

export type RequesterNoticeResult = { slack: boolean; email: boolean };

/**
 * Tell the requester about `kind`. `note` is the decision note, or the body
 * of a manager's message. `changes` are human lines for kind 'changed'.
 * `sentBy` is the Hub user acting (shown on messages, logged on all).
 *
 * Never throws.
 */
export async function notifyVehicleRequester(opts: {
  bookingId: string;
  kind: RequesterNoticeKind;
  note?: string | null;
  changes?: string[];
  sentBy?: string | null;
}): Promise<RequesterNoticeResult> {
  const result: RequesterNoticeResult = { slack: false, email: false };
  const note = (opts.note ?? "").trim() || null;
  const changes = opts.changes ?? [];
  if (opts.kind === "changed" && changes.length === 0) return result;

  try {
    const admin = createAdminClient() as Client;
    const { data } = await admin
      .from("vehicle_bookings")
      .select(
        "id, booking_name, requester_name, requester_email, requested_by, checkout_date, return_date, assignments:vehicle_booking_assignments(vehicle:vehicles(name, registration_plate))"
      )
      .eq("id", opts.bookingId)
      .maybeSingle();
    const b = data as Booking | null;
    if (!b) return result;

    const sender = await senderOf(admin, opts.sentBy);

    // Slack DM.
    if (process.env.SLACK_BOT_TOKEN) {
      try {
        const slackId = await requesterSlackId(admin, b);
        if (slackId) {
          const open = await slack.openConversation(slackId);
          if (open.ok && open.channel?.id) {
            const posted = await slack.postMessage({
              channel: open.channel.id,
              ...slackMessage(opts.kind, b, { note, changes, sender }),
            });
            result.slack = !!posted.ok;
            if (!posted.ok) console.error("[vehicles/requester] postMessage failed", posted.error);
          } else {
            console.error("[vehicles/requester] conversations.open failed", open.error);
          }
        }
      } catch (err) {
        console.error("[vehicles/requester] slack failed", err);
      }
    }

    // Email — always for lifecycle updates; for a typed message only when
    // Slack couldn't carry it.
    const wantEmail = opts.kind !== "message" || !result.slack;
    if (wantEmail && b.requester_email) {
      const whenLabel = dateRangeLabel(b.checkout_date, b.return_date);
      const firstName = firstNameOf(b.requester_name);
      const isDecision = opts.kind === "approved" || opts.kind === "denied";
      const html = isDecision
        ? vehicleRequestDecisionEmailHtml({
            requesterFirstName: firstName,
            bookingName: b.booking_name,
            whenLabel,
            approved: opts.kind === "approved",
            note,
            siteUrl: SITE,
          })
        : vehicleRequesterUpdateEmailHtml({
            kind: opts.kind as RequesterUpdateKind,
            requesterFirstName: firstName,
            bookingName: b.booking_name,
            whenLabel,
            vehicleLabel: vehicleLabelOf(b),
            note,
            changes,
            senderName: sender.name,
            bookingUrl: bookingUrl(b.id),
            siteUrl: SITE,
          });
      const subject = isDecision
        ? opts.kind === "approved"
          ? "Your vehicle request is approved"
          : "An update on your vehicle request"
        : vehicleRequesterUpdateSubject(opts.kind as RequesterUpdateKind);
      const sent = await sendTransactional({
        to: b.requester_email,
        subject,
        html,
        category: `vehicle_requester_${opts.kind}`,
        sourceType: "vehicle_booking",
        sourceId: b.id,
        reason:
          opts.kind === "message"
            ? "A vehicle manager messaged them about their booking"
            : "An update on the vehicle booking they made",
      }).catch(() => null);
      result.email = !!sent?.ok;
    }

    const body = opts.kind === "changed" ? changes.join("\n") : note;
    await admin.from("vehicle_booking_messages").insert({
      vehicle_booking_id: b.id,
      kind: opts.kind,
      body,
      sent_by: opts.sentBy ?? null,
      via_slack: result.slack,
      via_email: result.email,
    });
  } catch (err) {
    console.error("[vehicles/requester] notify failed", err);
  }
  return result;
}

export type RequesterMessageRow = {
  id: string;
  kind: RequesterNoticeKind;
  body: string | null;
  via_slack: boolean;
  via_email: boolean;
  sent_as_user: boolean;
  created_at: string;
  sender_name: string | null;
};

/** The log for the booking page, newest first. */
export async function getRequesterMessages(bookingId: string): Promise<RequesterMessageRow[]> {
  try {
    const admin = createAdminClient() as Client;
    const { data } = await admin
      .from("vehicle_booking_messages")
      .select("id, kind, body, via_slack, via_email, sent_as_user, created_at, sender:users!vehicle_booking_messages_sent_by_fkey(first_name, last_name, preferred_name)")
      .eq("vehicle_booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(50);
    return ((data ?? []) as (Omit<RequesterMessageRow, "sender_name"> & {
      sender: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
    })[]).map(({ sender, ...r }) => ({
      ...r,
      sender_name: sender
        ? [sender.preferred_name || sender.first_name, sender.last_name].filter(Boolean).join(" ") || null
        : null,
    }));
  } catch {
    return [];
  }
}

// ── messages sent as the manager ────────────────────────────

export type MessageAsSenderResult =
  | { ok: true; via: "slack" | "email" }
  | { ok: false; needsConnect: true }
  | { ok: false; needsConnect?: false; error: string };

/**
 * A manager's typed message to the requester, sent from the manager's own
 * Slack account so the reply comes straight back to them. Needs "Connect my
 * Slack" first. A requester who isn't on Slack gets it by email instead.
 */
export async function messageRequesterAsSender(opts: {
  bookingId: string;
  text: string;
  senderId: string;
}): Promise<MessageAsSenderResult> {
  const admin = createAdminClient() as Client;
  const token = await getSlackUserToken(admin, opts.senderId);
  if (!token || !hasAllScopes(token.scope)) return { ok: false, needsConnect: true };

  const { data } = await admin
    .from("vehicle_bookings")
    .select(
      "id, booking_name, requester_name, requester_email, requested_by, checkout_date, return_date, assignments:vehicle_booking_assignments(vehicle:vehicles(name, registration_plate))"
    )
    .eq("id", opts.bookingId)
    .maybeSingle();
  const b = data as Booking | null;
  if (!b) return { ok: false, error: "Booking not found." };

  const clientSlackId = await requesterSlackId(admin, b);
  if (!clientSlackId) {
    // Not on Slack — the existing email path (logged there).
    const r = await notifyVehicleRequester({
      bookingId: b.id,
      kind: "message",
      note: opts.text,
      sentBy: opts.senderId,
    });
    return r.email
      ? { ok: true, via: "email" }
      : { ok: false, error: "They aren't on Slack and there's no email on the booking." };
  }
  if (clientSlackId === token.slackUserId) {
    return { ok: false, error: "That's your own Slack account — you booked this one yourself." };
  }

  try {
    const open = await slack.openConversationAs(token.accessToken, clientSlackId);
    if (!open.ok || !open.channel?.id) {
      if (open.error === "invalid_auth" || open.error === "token_revoked" || open.error === "missing_scope")
        return { ok: false, needsConnect: true };
      return { ok: false, error: `Slack refused the DM (${open.error ?? "unknown"}).` };
    }
    const when = dateRangeLabel(b.checkout_date, b.return_date);
    const posted = await slack.postMessageAs(token.accessToken, {
      channel: open.channel.id,
      // The footer tells them Slack is the place to answer — no need to open the Hub.
      text: `${opts.text}\n\n_Sent from the FFSA Hub about <${bookingUrl(b.id)}|${b.booking_name}> · ${when}. Just reply here._`,
    });
    if (!posted.ok) {
      if (posted.error === "invalid_auth" || posted.error === "token_revoked" || posted.error === "missing_scope")
        return { ok: false, needsConnect: true };
      return { ok: false, error: `Slack refused the message (${posted.error ?? "unknown"}).` };
    }
    await admin.from("vehicle_booking_messages").insert({
      vehicle_booking_id: b.id,
      kind: "message",
      body: opts.text,
      sent_by: opts.senderId,
      via_slack: true,
      via_email: false,
      sent_as_user: true,
      slack_channel: open.channel.id,
      slack_ts: posted.ts ?? null,
    });
    return { ok: true, via: "slack" };
  } catch (err) {
    console.error("[vehicles/requester] send-as-user failed", err);
    return { ok: false, error: "Couldn't reach Slack — try again." };
  }
}

// ── the DM conversation, read back onto the booking ─────────

export type ConversationLine = {
  ts: string;
  at: string;
  fromRequester: boolean;
  who: string;
  text: string;
};

/** Slack mrkdwn → readable plain text (links, mentions, entities). */
function plain(text: string): string {
  return text
    // The booking footer we append when sending (current and original
    // wording) — redundant on the booking page itself.
    .replace(/\n*_(?:Sent from the FFSA Hub about|Re:) [^\n]*_\s*$/, "")
    // Slack mrkdwn emphasis: _italic_, *bold*, ~strike~.
    .replace(/(^|[\s(])([_*~])([^\n]+?)\2(?=$|[\s).,!?:;])/g, "$1$3")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/<@[A-Z0-9]+>/g, "@someone")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The manager ↔ requester DM, from the first Hub message about this booking
 * until two weeks after its return date — read with the manager's own token.
 * Empty if nobody has messaged as themselves, or the token has gone.
 */
export async function getBookingConversation(bookingId: string): Promise<ConversationLine[]> {
  try {
    const admin = createAdminClient() as Client;
    const [{ data: rows }, { data: booking }] = await Promise.all([
      admin
        .from("vehicle_booking_messages")
        .select("sent_by, slack_channel, slack_ts")
        .eq("vehicle_booking_id", bookingId)
        .eq("sent_as_user", true)
        .not("slack_channel", "is", null)
        .order("created_at", { ascending: true }),
      admin
        .from("vehicle_bookings")
        .select("requester_name, return_date")
        .eq("id", bookingId)
        .maybeSingle(),
    ]);
    const threads = new Map<string, { senderId: string; channel: string; oldest: string }>();
    for (const r of (rows ?? []) as { sent_by: string | null; slack_channel: string; slack_ts: string | null }[]) {
      if (!r.sent_by || !r.slack_ts) continue;
      const key = `${r.sent_by}:${r.slack_channel}`;
      if (!threads.has(key)) threads.set(key, { senderId: r.sent_by, channel: r.slack_channel, oldest: r.slack_ts });
    }
    if (threads.size === 0) return [];

    const latest = booking?.return_date
      ? String(Math.floor(new Date(`${booking.return_date}T23:59:59Z`).getTime() / 1000) + 14 * 86400)
      : undefined;
    const requesterName = (booking?.requester_name as string | null) ?? "Requester";

    const lines: ConversationLine[] = [];
    for (const t of threads.values()) {
      const token = await getSlackUserToken(admin, t.senderId);
      if (!token) continue;
      const sender = await senderOf(admin, t.senderId);
      const res = await slack.conversationHistoryAs(token.accessToken, {
        channel: t.channel,
        oldest: t.oldest,
        latest,
        limit: 200,
      });
      if (!res.ok) {
        console.error("[vehicles/requester] history failed", res.error);
        continue;
      }
      for (const m of res.messages ?? []) {
        if (m.subtype && m.subtype !== "thread_broadcast" && m.subtype !== "file_share") continue;
        const fromSender = m.user === token.slackUserId;
        lines.push({
          ts: m.ts,
          at: new Date(Number(m.ts) * 1000).toISOString(),
          fromRequester: !fromSender,
          who: fromSender ? sender.name ?? "Coordinator" : requesterName,
          text: plain(m.text ?? ""),
        });
      }
    }
    return lines.sort((a, b) => Number(a.ts) - Number(b.ts));
  } catch (err) {
    console.error("[vehicles/requester] conversation failed", err);
    return [];
  }
}

/** Is this person connected to Slack with everything the Hub needs? */
export async function isSlackConnected(userId: string): Promise<boolean> {
  const token = await getSlackUserToken(createAdminClient(), userId);
  return !!token && hasAllScopes(token.scope);
}
