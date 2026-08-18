// Scheduling service — availability-poll style.
//
// Flow: team creates a scheduling_request → recipient picks slots via
// magic-token link → team picks one → confirmation email with ICS.
//
// All writes use the admin client (RLS bypass). Reads use whatever the
// caller passes — RLS allows any authenticated user to read.

import { schedulingRequestEmailHtml } from "@/lib/email/templates/scheduling-request";
import { schedulingSlotsSubmittedEmailHtml } from "@/lib/email/templates/scheduling-slots-submitted";
import { schedulingConfirmedEmailHtml } from "@/lib/email/templates/scheduling-confirmed";
import { buildIcsInvite } from "@/lib/scheduling/ics";
import { getResend } from "@/lib/email/resend";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const FROM_EMAIL = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
const FROM_HEADER = `Fire & Fragrance SA <${FROM_EMAIL}>`;
const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://ffsahub.com";

export type SchedulingRequest = {
  id: string;
  enrollment_id: string | null;
  contact_id: string;
  requested_by: string;
  status: "pending" | "awaiting_selection" | "scheduled" | "cancelled";
  duration_minutes: number;
  message: string | null;
  magic_token: string;
  created_at: string;
  expires_at: string;
  scheduled_at: string | null;
  cancelled_at: string | null;
};

export type SchedulingSlot = {
  id: string;
  request_id: string;
  starts_at: string;
  ends_at: string;
  proposed_by: "recipient" | "team";
  is_chosen: boolean;
  created_at: string;
};

export type SchedulingRequestWithSlots = SchedulingRequest & {
  slots: SchedulingSlot[];
};

function fullName(p: {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
}): string {
  const first = p.preferred_name || p.first_name || "";
  const last = p.last_name || "";
  return `${first} ${last}`.trim();
}

function formatSlotForRecipient(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
    timeZoneName: "short",
  });
}

// ─────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────

export async function createSchedulingRequest(
  adminSupabase: Client,
  input: {
    contactId: string;
    requestedBy: string; // user id
    enrollmentId?: string | null;
    durationMinutes?: number;
    message?: string | null;
    expiryDays?: number;
    sendEmail?: boolean; // default true; false = create the request only (caller embeds the link)
  }
): Promise<{ request: SchedulingRequest; magicLink: string; emailError: string | null } | { error: string }> {
  const durationMinutes = input.durationMinutes ?? 30;
  const expiryDays = input.expiryDays ?? 7;
  const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();

  const insertPayload: Record<string, unknown> = {
    contact_id: input.contactId,
    requested_by: input.requestedBy,
    enrollment_id: input.enrollmentId ?? null,
    duration_minutes: durationMinutes,
    message: input.message ?? null,
    expires_at: expiresAt,
  };

  const { data: request, error } = await adminSupabase
    .from("scheduling_requests")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error || !request) {
    return { error: error?.message ?? "Failed to create request" };
  }

  const req = request as SchedulingRequest;
  const magicLink = `${SITE_URL}/schedule/${req.magic_token}`;

  // Fetch recipient + requester for the email
  const [{ data: contact }, { data: requester }] = await Promise.all([
    adminSupabase
      .from("contacts")
      .select("email, first_name, last_name, preferred_name")
      .eq("id", input.contactId)
      .single(),
    adminSupabase
      .from("users")
      .select("first_name, last_name, preferred_name")
      .eq("id", input.requestedBy)
      .single(),
  ]);

  let emailError: string | null = null;
  if (input.sendEmail !== false && contact?.email) {
    try {
      await getResend().emails.send({
        from: FROM_HEADER,
        to: contact.email,
        subject: `Let's schedule a quick call`,
        html: schedulingRequestEmailHtml({
          firstName: contact.preferred_name || contact.first_name || "there",
          senderName: fullName(requester ?? {}) || "Someone from Fire & Fragrance",
          durationMinutes,
          expiresAt,
          message: input.message ?? null,
          magicLinkUrl: magicLink,
        }),
      });
    } catch (e) {
      emailError = e instanceof Error ? e.message : "Failed to send email";
    }
  } else if (input.sendEmail !== false) {
    emailError = "Contact has no email on file";
  }

  // Activity log
  await adminSupabase.from("activity_events").insert({
    contact_id: input.contactId,
    event_type: "scheduling_requested",
    payload: {
      request_id: req.id,
      enrollment_id: input.enrollmentId ?? null,
      duration_minutes: durationMinutes,
      expires_at: expiresAt,
    },
    related_user_id: input.requestedBy,
  });

  return { request: req, magicLink, emailError };
}

// ─────────────────────────────────────────────────────────────────
// Public read by token
// ─────────────────────────────────────────────────────────────────

export type PublicSchedulingView = {
  request: SchedulingRequest;
  contact: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
  };
  requester: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
  };
  existingSlots: SchedulingSlot[];
  expired: boolean;
};

export async function getSchedulingRequestByToken(
  adminSupabase: Client,
  token: string
): Promise<PublicSchedulingView | null> {
  const { data: request } = await adminSupabase
    .from("scheduling_requests")
    .select("*")
    .eq("magic_token", token)
    .single();

  if (!request) return null;
  const req = request as SchedulingRequest;

  const [{ data: contact }, { data: requester }, { data: slots }] =
    await Promise.all([
      adminSupabase
        .from("contacts")
        .select("first_name, last_name, preferred_name")
        .eq("id", req.contact_id)
        .single(),
      adminSupabase
        .from("users")
        .select("first_name, last_name, preferred_name")
        .eq("id", req.requested_by)
        .single(),
      adminSupabase
        .from("scheduling_slots")
        .select("*")
        .eq("request_id", req.id)
        .order("starts_at", { ascending: true }),
    ]);

  const expired =
    req.status === "pending" && new Date(req.expires_at) < new Date();

  return {
    request: req,
    contact: contact ?? { first_name: null, last_name: null, preferred_name: null },
    requester: requester ?? { first_name: null, last_name: null, preferred_name: null },
    existingSlots: (slots ?? []) as SchedulingSlot[],
    expired,
  };
}

// ─────────────────────────────────────────────────────────────────
// Recipient submits slots
// ─────────────────────────────────────────────────────────────────

export async function submitProposedSlots(
  adminSupabase: Client,
  token: string,
  slots: Array<{ starts_at: string; ends_at: string }>
): Promise<{ success: true; count: number } | { error: string }> {
  if (slots.length === 0) return { error: "Pick at least one time." };
  if (slots.length > 20) return { error: "Too many slots." };

  const { data: request } = await adminSupabase
    .from("scheduling_requests")
    .select("*")
    .eq("magic_token", token)
    .single();

  if (!request) return { error: "Invalid link." };
  const req = request as SchedulingRequest;

  if (req.status !== "pending") {
    return { error: "This request can no longer accept times." };
  }
  if (new Date(req.expires_at) < new Date()) {
    return { error: "This link has expired." };
  }

  // Sanity check slot times — must be in the future and within 60 days
  const now = Date.now();
  const farFuture = now + 60 * 86_400_000;
  for (const s of slots) {
    const start = new Date(s.starts_at).getTime();
    const end = new Date(s.ends_at).getTime();
    if (!isFinite(start) || !isFinite(end) || end <= start) {
      return { error: "One of the times looks invalid." };
    }
    if (start < now) return { error: "Pick a time in the future." };
    if (start > farFuture) return { error: "Pick a time within 60 days." };
  }

  const rows = slots.map((s) => ({
    request_id: req.id,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    proposed_by: "recipient",
  }));

  const { error: insertError } = await adminSupabase
    .from("scheduling_slots")
    .insert(rows);
  if (insertError) return { error: insertError.message };

  const statusUpdate: Record<string, unknown> = {
    status: "awaiting_selection",
  };
  const { error: updateError } = await adminSupabase
    .from("scheduling_requests")
    .update(statusUpdate)
    .eq("id", req.id);
  if (updateError) return { error: updateError.message };

  // Notify the requesting team member
  await sendSlotsSubmittedNotification(adminSupabase, req, slots);

  // Activity log
  await adminSupabase.from("activity_events").insert({
    contact_id: req.contact_id,
    event_type: "scheduling_slots_submitted",
    payload: {
      request_id: req.id,
      slot_count: slots.length,
    },
  });

  return { success: true, count: slots.length };
}

async function sendSlotsSubmittedNotification(
  adminSupabase: Client,
  req: SchedulingRequest,
  slots: Array<{ starts_at: string; ends_at: string }>
) {
  const [{ data: contact }, { data: requester }] = await Promise.all([
    adminSupabase
      .from("contacts")
      .select("first_name, last_name, preferred_name")
      .eq("id", req.contact_id)
      .single(),
    adminSupabase
      .from("users")
      .select("email, first_name, last_name, preferred_name")
      .eq("id", req.requested_by)
      .single(),
  ]);

  if (!requester?.email) return;

  try {
    await getResend().emails.send({
      from: FROM_HEADER,
      to: requester.email,
      subject: `${fullName(contact ?? {}) || "Someone"} sent you times`,
      html: schedulingSlotsSubmittedEmailHtml({
        staffFirstName:
          requester.preferred_name || requester.first_name || "there",
        recipientName: fullName(contact ?? {}) || "Your contact",
        slotCount: slots.length,
        firstSlotsPreview: slots.map((s) => formatSlotForRecipient(s.starts_at)),
        followupUrl: `${SITE_URL}/contacts/event-followup`,
      }),
    });
  } catch {
    // Don't fail the submission if email fails.
  }
}

// ─────────────────────────────────────────────────────────────────
// Team confirms slot
// ─────────────────────────────────────────────────────────────────

export async function confirmSchedulingSlot(
  adminSupabase: Client,
  requestId: string,
  slotId: string,
  confirmedBy: string,
  message?: string | null
): Promise<{ success: true } | { error: string }> {
  const { data: request } = await adminSupabase
    .from("scheduling_requests")
    .select("*")
    .eq("id", requestId)
    .single();
  if (!request) return { error: "Request not found." };
  const req = request as SchedulingRequest;
  if (req.status === "scheduled") return { error: "Already scheduled." };
  if (req.status === "cancelled") return { error: "Request is cancelled." };

  const { data: slot } = await adminSupabase
    .from("scheduling_slots")
    .select("*")
    .eq("id", slotId)
    .eq("request_id", requestId)
    .single();
  if (!slot) return { error: "Slot not found for this request." };
  const chosenSlot = slot as SchedulingSlot;

  // Mark this slot chosen
  const slotUpdate: Record<string, unknown> = { is_chosen: true };
  const { error: slotError } = await adminSupabase
    .from("scheduling_slots")
    .update(slotUpdate)
    .eq("id", slotId);
  if (slotError) return { error: slotError.message };

  // A note typed at confirm time wins; otherwise keep the request's message.
  const finalMessage = message?.trim() ? message.trim() : req.message;

  const reqUpdate: Record<string, unknown> = {
    status: "scheduled",
    scheduled_at: new Date().toISOString(),
    message: finalMessage,
  };
  const { error: updateError } = await adminSupabase
    .from("scheduling_requests")
    .update(reqUpdate)
    .eq("id", requestId);
  if (updateError) return { error: updateError.message };

  // Send the confirmation email with ICS — include the confirm-time note.
  await sendConfirmationEmail(
    adminSupabase,
    { ...req, message: finalMessage },
    chosenSlot,
    confirmedBy
  );

  // Activity log
  await adminSupabase.from("activity_events").insert({
    contact_id: req.contact_id,
    event_type: "scheduling_confirmed",
    payload: {
      request_id: req.id,
      slot_id: slotId,
      starts_at: chosenSlot.starts_at,
      ends_at: chosenSlot.ends_at,
    },
    related_user_id: confirmedBy,
  });

  return { success: true };
}

async function sendConfirmationEmail(
  adminSupabase: Client,
  req: SchedulingRequest,
  slot: SchedulingSlot,
  confirmedBy: string
) {
  const [{ data: contact }, { data: requester }] = await Promise.all([
    adminSupabase
      .from("contacts")
      .select("email, first_name, last_name, preferred_name")
      .eq("id", req.contact_id)
      .single(),
    adminSupabase
      .from("users")
      .select("email, first_name, last_name, preferred_name")
      .eq("id", confirmedBy)
      .single(),
  ]);

  if (!contact?.email || !requester?.email) return;

  const senderName =
    fullName(requester) || "Fire & Fragrance South Africa";
  const recipientName = fullName(contact) || contact.email;
  const formattedDateTime = formatSlotForRecipient(slot.starts_at);

  const ics = buildIcsInvite({
    uid: `${req.id}@ffsahub.com`,
    summary: `${senderName} ↔ ${recipientName}`,
    description: req.message ?? `Scheduled via Fire & Fragrance South Africa.`,
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    organizer: { name: senderName, email: requester.email },
    attendee: { name: recipientName, email: contact.email },
    url: SITE_URL,
  });

  try {
    await getResend().emails.send({
      from: FROM_HEADER,
      to: contact.email,
      subject: `Confirmed: ${formattedDateTime}`,
      html: schedulingConfirmedEmailHtml({
        firstName: contact.preferred_name || contact.first_name || "there",
        senderName,
        formattedDateTime,
        durationMinutes: req.duration_minutes,
        message: req.message,
      }),
      attachments: [
        {
          filename: "invite.ics",
          content: Buffer.from(ics, "utf-8"),
          contentType: "text/calendar; method=REQUEST; charset=utf-8",
        },
      ],
    });
  } catch {
    // Don't fail the confirmation if email fails.
  }
}

// ─────────────────────────────────────────────────────────────────
// Cancel
// ─────────────────────────────────────────────────────────────────

export async function cancelSchedulingRequest(
  adminSupabase: Client,
  requestId: string,
  cancelledBy: string
): Promise<{ success: true } | { error: string }> {
  const { data: request } = await adminSupabase
    .from("scheduling_requests")
    .select("*")
    .eq("id", requestId)
    .single();
  if (!request) return { error: "Request not found." };
  const req = request as SchedulingRequest;
  if (req.status === "cancelled") return { success: true };
  if (req.status === "scheduled") {
    return { error: "Cancel a scheduled call manually with the recipient first." };
  }

  const update: Record<string, unknown> = {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
  };
  const { error } = await adminSupabase
    .from("scheduling_requests")
    .update(update)
    .eq("id", requestId);
  if (error) return { error: error.message };

  await adminSupabase.from("activity_events").insert({
    contact_id: req.contact_id,
    event_type: "scheduling_cancelled",
    payload: { request_id: req.id },
    related_user_id: cancelledBy,
  });

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Drawer fetch — most recent open request for an enrollment
// ─────────────────────────────────────────────────────────────────

export async function getActiveSchedulingForEnrollment(
  supabase: Client,
  enrollmentId: string
): Promise<SchedulingRequestWithSlots | null> {
  const { data: request } = await supabase
    .from("scheduling_requests")
    .select("*")
    .eq("enrollment_id", enrollmentId)
    .in("status", ["pending", "awaiting_selection", "scheduled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!request) return null;
  const req = request as SchedulingRequest;

  const { data: slots } = await supabase
    .from("scheduling_slots")
    .select("*")
    .eq("request_id", req.id)
    .order("starts_at", { ascending: true });

  return { ...req, slots: (slots ?? []) as SchedulingSlot[] };
}
