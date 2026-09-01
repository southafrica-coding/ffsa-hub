import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

export type VehicleManagerEvent =
  | "requested"
  | "collected"
  | "returned"
  | "cancelled";

const COPY: Record<
  VehicleManagerEvent,
  { eyebrow: string; heading: string; subject: string; lead: (b: string) => string }
> = {
  requested: {
    eyebrow: "New Request",
    heading: "A vehicle has been requested",
    subject: "New vehicle request",
    lead: (b) => `${b} has been requested and is waiting for a decision.`,
  },
  collected: {
    eyebrow: "Signed Out",
    heading: "A vehicle has been signed out",
    subject: "Vehicle signed out",
    lead: (b) => `The sign-out form for ${b} has been completed.`,
  },
  returned: {
    eyebrow: "Signed In",
    heading: "A vehicle has been signed in",
    subject: "Vehicle signed in",
    lead: (b) => `The sign-in form for ${b} has been completed.`,
  },
  cancelled: {
    eyebrow: "Cancelled",
    heading: "A vehicle booking was cancelled",
    subject: "Vehicle booking cancelled",
    lead: (b) => `${b} has been cancelled by the requester.`,
  },
};

export function vehicleManagerAlertSubject(event: VehicleManagerEvent): string {
  return COPY[event].subject;
}

// Sent to everyone holding vehicles.approve / vehicles.manage. One template,
// four events — the coordinator's running feed of what's happening to the fleet.
export function vehicleManagerAlertEmailHtml({
  event,
  bookingName,
  requesterName,
  whenLabel,
  vehicleLabel,
  detailHtml,
  bookingUrl,
  siteUrl,
}: {
  event: VehicleManagerEvent;
  bookingName: string;
  requesterName: string | null;
  whenLabel: string;
  vehicleLabel: string | null;
  detailHtml?: string | null;
  bookingUrl: string;
  siteUrl: string;
}): string {
  const copy = COPY[event];
  const facts = [
    requesterName ? `${emphasis("Requester:")} ${escapeHtml(requesterName)}` : null,
    `${emphasis("Dates:")} ${escapeHtml(whenLabel)}`,
    vehicleLabel ? `${emphasis("Vehicle:")} ${escapeHtml(vehicleLabel)}` : null,
  ].filter(Boolean) as string[];

  return renderEmailShell({
    title: copy.subject,
    preheader: copy.lead(bookingName),
    eyebrow: copy.eyebrow,
    heading: copy.heading,
    bodyHtml: `
      ${bodyParagraph(copy.lead(emphasis(escapeHtml(bookingName))))}
      ${facts.map((f) => bodyParagraph(f)).join("")}
      ${detailHtml ?? ""}
    `,
    cta: {
      label: event === "requested" ? "Review the request" : "Open the booking",
      url: bookingUrl,
    },
    siteUrl,
  });
}
