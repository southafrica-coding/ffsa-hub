import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

// Sent to a public requester the moment they submit the vehicle-request form.
// They have no Hub account, so there's no CTA — just a clear "we've got it,
// it's pending approval" confirmation that echoes back what they asked for.
export function vehicleRequestReceivedEmailHtml({
  requesterFirstName,
  bookingName,
  whenLabel,
  vehiclesLine,
  siteUrl,
}: {
  requesterFirstName: string;
  bookingName: string;
  whenLabel: string;
  vehiclesLine: string | null;
  siteUrl: string;
}): string {
  return renderEmailShell({
    title: "We've received your vehicle request",
    preheader: "Your vehicle request is pending approval.",
    eyebrow: "Request Received",
    heading: "We've got your request",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(requesterFirstName)}, thanks for your request to use a Fire &amp; Fragrance SA vehicle. It's now with the Vehicle Coordinator for review &mdash; submitting a request doesn't guarantee a vehicle.`)}
      ${bodyParagraph(`${emphasis("Request:")} ${escapeHtml(bookingName)}`)}
      ${bodyParagraph(`${emphasis("Dates:")} ${escapeHtml(whenLabel)}`)}
      ${vehiclesLine ? bodyParagraph(`${emphasis("Vehicle(s) requested:")} ${escapeHtml(vehiclesLine)}`) : ""}
      ${bodyParagraph(`We'll email you again as soon as it's approved or declined. If anything changes in the meantime, just reply to this email.`)}
    `,
    siteUrl,
  });
}
