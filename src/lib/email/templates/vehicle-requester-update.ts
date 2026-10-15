import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

// Sent to the person who booked a vehicle whenever something about their
// booking changes (and for messages a vehicle manager writes them). The
// approve / deny emails keep their own template (vehicle-request-decision).
// Mirrors the Slack DM of the same event — see lib/vehicles/requester-notify.

export type RequesterUpdateKind =
  | "submitted"
  | "reopened"
  | "changed"
  | "cancelled"
  | "completed"
  | "message";

const COPY: Record<RequesterUpdateKind, { subject: string; eyebrow: string; heading: string }> = {
  submitted: {
    subject: "We've received your vehicle request",
    eyebrow: "Request Received",
    heading: "We've got your request",
  },
  reopened: {
    subject: "Your vehicle booking is back to pending",
    eyebrow: "Back To Pending",
    heading: "Your booking is back to pending",
  },
  changed: {
    subject: "Your vehicle booking was updated",
    eyebrow: "Booking Updated",
    heading: "Your booking was updated",
  },
  cancelled: {
    subject: "Your vehicle booking was cancelled",
    eyebrow: "Booking Cancelled",
    heading: "Your booking was cancelled",
  },
  completed: {
    subject: "Your vehicle booking is complete",
    eyebrow: "Booking Complete",
    heading: "All done — thank you",
  },
  message: {
    subject: "A message about your vehicle booking",
    eyebrow: "Vehicle Booking",
    heading: "A message about your booking",
  },
};

export function vehicleRequesterUpdateSubject(kind: RequesterUpdateKind): string {
  return COPY[kind].subject;
}

export function vehicleRequesterUpdateEmailHtml({
  kind,
  requesterFirstName,
  bookingName,
  whenLabel,
  vehicleLabel,
  note,
  changes,
  senderName,
  bookingUrl,
  siteUrl,
}: {
  kind: RequesterUpdateKind;
  requesterFirstName: string;
  bookingName: string;
  whenLabel: string;
  vehicleLabel: string | null;
  note?: string | null;
  changes?: string[];
  senderName?: string | null;
  bookingUrl: string;
  siteUrl: string;
}): string {
  const c = COPY[kind];
  const name = emphasis(escapeHtml(bookingName));
  const when = escapeHtml(whenLabel);
  const hi = `Hi ${escapeHtml(requesterFirstName)},`;

  let lead: string;
  switch (kind) {
    case "submitted":
      lead = `${hi} thanks &mdash; your request ${name} for ${when} is in. The Vehicle Coordinator will confirm it shortly.`;
      break;
    case "reopened":
      lead = `${hi} your booking ${name} for ${when} has been moved back to pending while a few details are confirmed. It isn't confirmed until it's approved again &mdash; we'll let you know as soon as it is.`;
      break;
    case "changed":
      lead = `${hi} the Vehicle Coordinator made some changes to your booking ${name}:`;
      break;
    case "cancelled":
      lead = `${hi} your booking ${name} for ${when} has been cancelled.`;
      break;
    case "completed":
      lead = `${hi} your booking ${name} is complete. Thanks for looking after the vehicle.`;
      break;
    case "message":
      lead = `${hi} ${emphasis(escapeHtml(senderName ?? "The Vehicle Coordinator"))} sent you a message about your booking ${name} (${when}):`;
      break;
  }

  const changeList =
    changes && changes.length
      ? `<ul style="margin:0 0 16px 18px;padding:0;">${changes
          .map((l) => `<li style="margin:0 0 4px 0;">${escapeHtml(l)}</li>`)
          .join("")}</ul>`
      : "";
  const vehicle =
    vehicleLabel && kind !== "message"
      ? bodyParagraph(`${emphasis("Vehicle:")} ${escapeHtml(vehicleLabel)}`)
      : "";
  const noteHtml = note
    ? kind === "message"
      ? bodyParagraph(escapeHtml(note).replace(/\n/g, "<br/>"))
      : bodyParagraph(`${emphasis("Note from the coordinator:")} ${escapeHtml(note)}`)
    : "";

  return renderEmailShell({
    title: c.subject,
    preheader: c.subject,
    eyebrow: c.eyebrow,
    heading: c.heading,
    bodyHtml: `
      ${bodyParagraph(lead)}
      ${changeList}
      ${noteHtml}
      ${vehicle}
    `,
    cta: { label: "View booking", url: bookingUrl },
    siteUrl,
  });
}
