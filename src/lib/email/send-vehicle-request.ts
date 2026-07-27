// Rent a Vehicle transactional email dispatcher.
// Mirrors send-prayer-room.ts: transactional system email goes through Resend,
// and every send is wrapped so a mail failure never breaks the action.
//
// Used primarily for PUBLIC (non-Hub) requesters who submit via the pasteable
// /request-vehicle/<slug> link and can't see the in-app feed — they get a
// confirmation on submit and an approve/deny email on decision.

import { Resend } from "resend";
import { dateRangeLabel } from "@/lib/bookings/dates";
import { vehicleRequestReceivedEmailHtml } from "./templates/vehicle-request-received";
import { vehicleRequestDecisionEmailHtml } from "./templates/vehicle-request-decision";

const resend = new Resend(process.env.RESEND_API_KEY?.trim());
const FROM = `Fire & Fragrance SA <${(process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim()}>`;
const SITE =
  process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://ffsahub.com";

function firstNameOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

export async function sendVehicleRequestReceived(opts: {
  email: string | null;
  requesterName: string | null;
  bookingName: string;
  checkoutDate: string;
  returnDate: string;
  /** Display names of the requested vehicles, if any were picked. */
  vehicleNames?: string[];
}) {
  if (!opts.email) return;
  try {
    await resend.emails.send({
      from: FROM,
      to: opts.email,
      subject: "We've received your vehicle request",
      html: vehicleRequestReceivedEmailHtml({
        requesterFirstName: firstNameOf(opts.requesterName),
        bookingName: opts.bookingName,
        whenLabel: dateRangeLabel(opts.checkoutDate, opts.returnDate),
        vehiclesLine: opts.vehicleNames?.length ? opts.vehicleNames.join(", ") : null,
        siteUrl: SITE,
      }),
    });
  } catch {
    console.error("[vehicles] request-received email failed");
  }
}

export async function sendVehicleRequestDecision(opts: {
  email: string | null;
  requesterName: string | null;
  bookingName: string;
  checkoutDate: string;
  returnDate: string;
  approved: boolean;
  note?: string | null;
}) {
  if (!opts.email) return;
  try {
    await resend.emails.send({
      from: FROM,
      to: opts.email,
      subject: opts.approved
        ? "Your vehicle request is approved"
        : "An update on your vehicle request",
      html: vehicleRequestDecisionEmailHtml({
        requesterFirstName: firstNameOf(opts.requesterName),
        bookingName: opts.bookingName,
        whenLabel: dateRangeLabel(opts.checkoutDate, opts.returnDate),
        approved: opts.approved,
        note: opts.note,
        siteUrl: SITE,
      }),
    });
  } catch {
    console.error("[vehicles] decision email failed");
  }
}
