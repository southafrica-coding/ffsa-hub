// Rent a Vehicle transactional email dispatcher.
// Mirrors send-prayer-room.ts: transactional system email goes through Resend,
// and every send is wrapped so a mail failure never breaks the action.
//
// Requesters are Hub users, so they see their request in the app; this sends
// the approve/deny notification on decision.

import { dateRangeLabel } from "@/lib/bookings/dates";
import { vehicleRequestDecisionEmailHtml } from "./templates/vehicle-request-decision";
import { getResend } from "@/lib/email/resend";

const FROM = `Fire & Fragrance SA <${(process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim()}>`;
const SITE =
  process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://ffsahub.com";

function firstNameOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
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
    await getResend().emails.send({
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
