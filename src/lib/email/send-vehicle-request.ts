// Rent a Vehicle transactional email dispatcher.
// Mirrors send-prayer-room.ts: transactional system email goes through Resend,
// and every send is wrapped so a mail failure never breaks the action.
//
// Requester-facing updates (approve / deny / changes / messages) live in
// lib/vehicles/requester-notify — Slack DM + email together.

import { dateRangeLabel } from "@/lib/bookings/dates";
import { notifyVehicleSlack } from "@/lib/vehicles/slack-alerts";
import { vehicleFormReminderEmailHtml } from "./templates/vehicle-form-reminder";
import {
  vehicleManagerAlertEmailHtml,
  vehicleManagerAlertSubject,
  type VehicleManagerEvent,
} from "./templates/vehicle-manager-alert";
import { sendTransactional } from "@/lib/email/send-transactional";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVehicleManagerEmails } from "@/services/vehicles";

const SITE =
  process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://ffsahub.com";

function firstNameOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

/**
 * Collection-day / return-day nudge to the requester, carrying a deep link to
 * the matching in-Hub form. Sent by the daily cron — never inline.
 *
 * Returns the sendTransactional result so the cron can decide whether to stamp
 * the send-once column: a hard provider error leaves it unstamped so tomorrow
 * retries, while a suppressed address is stamped (it will never deliver).
 */
export async function sendVehicleFormReminder(opts: {
  email: string;
  requesterName: string | null;
  bookingId: string;
  bookingName: string;
  kind: "collection" | "return";
  checkoutDate: string;
  returnDate: string;
  vehicleLabel: string | null;
}) {
  const path = opts.kind === "collection" ? "collect" : "return";
  const formUrl = `${SITE}/bookings/vehicles/${opts.bookingId}/${path}`;
  const dateLabel =
    opts.kind === "collection" ? opts.checkoutDate : opts.returnDate;

  return sendTransactional({
    to: opts.email,
    subject:
      opts.kind === "collection"
        ? "Today: complete your vehicle sign-out form"
        : "Today: complete your vehicle sign-in form",
    html: vehicleFormReminderEmailHtml({
      requesterFirstName: firstNameOf(opts.requesterName),
      bookingName: opts.bookingName,
      kind: opts.kind,
      dateLabel,
      vehicleLabel: opts.vehicleLabel,
      formUrl,
      siteUrl: SITE,
    }),
    category: `vehicle_${opts.kind}_form`,
    sourceType: "vehicle_booking",
    sourceId: opts.bookingId,
    reason:
      opts.kind === "collection"
        ? "Their approved vehicle booking is collected today"
        : "Their vehicle booking is due back today",
  });
}

/**
 * Tell the vehicle managers something happened. Best-effort and fan-out: one
 * failed address must not stop the others, and no mail failure may break the
 * action that triggered it.
 */
export async function notifyVehicleManagers(opts: {
  event: VehicleManagerEvent;
  bookingId: string;
  bookingName: string;
  requesterName: string | null;
  checkoutDate: string;
  returnDate: string;
  vehicleLabel?: string | null;
  detailHtml?: string | null;
}) {
  // Slack DMs to the coordinator ride alongside the emails (never instead).
  const slackDone = notifyVehicleSlack(opts.event, opts.bookingId);
  try {
    const admin = createAdminClient();
    const recipients = await getVehicleManagerEmails(admin);
    if (recipients.length === 0) {
      await slackDone;
      return;
    }

    const html = vehicleManagerAlertEmailHtml({
      event: opts.event,
      bookingName: opts.bookingName,
      requesterName: opts.requesterName,
      whenLabel: dateRangeLabel(opts.checkoutDate, opts.returnDate),
      vehicleLabel: opts.vehicleLabel ?? null,
      detailHtml: opts.detailHtml ?? null,
      bookingUrl: `${SITE}/bookings/vehicles/${opts.bookingId}`,
      siteUrl: SITE,
    });
    const subject = vehicleManagerAlertSubject(opts.event);

    await Promise.all(
      recipients.map((to) =>
        sendTransactional({
          to,
          subject,
          html,
          category: `vehicle_manager_${opts.event}`,
          sourceType: "vehicle_booking",
          sourceId: opts.bookingId,
          reason: "They manage vehicle bookings",
        }).catch(() => null)
      )
    );
  } catch {
    console.error("[vehicles] manager notification failed");
  }
  await slackDone;
}
