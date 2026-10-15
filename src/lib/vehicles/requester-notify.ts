// Vehicles → the person who booked (migration 239).
//
// Every confirmation and update about a booking goes straight to its
// requester as a Slack DM, alongside an email (public requesters and anyone
// not linked to Slack still hear about it). A vehicle manager can also write
// the requester a message from the booking page — that one is Slack-first and
// only falls back to email when there's no Slack account to reach.
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
  created_at: string;
  sender_name: string | null;
};

/** The log for the booking page, newest first. */
export async function getRequesterMessages(bookingId: string): Promise<RequesterMessageRow[]> {
  try {
    const admin = createAdminClient() as Client;
    const { data } = await admin
      .from("vehicle_booking_messages")
      .select("id, kind, body, via_slack, via_email, created_at, sender:users!vehicle_booking_messages_sent_by_fkey(first_name, last_name, preferred_name)")
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
