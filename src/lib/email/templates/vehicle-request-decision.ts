import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

// Sent to a requester when the Vehicle Coordinator approves or declines their
// request. Used for public (non-Hub) requesters; internal staff also have the
// in-app feed. `approved=false` covers a denied request.
export function vehicleRequestDecisionEmailHtml({
  requesterFirstName,
  bookingName,
  whenLabel,
  approved,
  note,
  siteUrl,
}: {
  requesterFirstName: string;
  bookingName: string;
  whenLabel: string;
  approved: boolean;
  note?: string | null;
  siteUrl: string;
}): string {
  const noteHtml = note
    ? bodyParagraph(`${emphasis("Note from the coordinator:")} ${escapeHtml(note)}`)
    : "";

  if (approved) {
    return renderEmailShell({
      title: "Your vehicle request is approved",
      preheader: "Your vehicle request has been approved.",
      eyebrow: "Request Approved",
      heading: "Your request is approved",
      bodyHtml: `
        ${bodyParagraph(`Hi ${escapeHtml(requesterFirstName)}, good news &mdash; your request ${emphasis(escapeHtml(bookingName))} for ${escapeHtml(whenLabel)} has been approved.`)}
        ${bodyParagraph(`The Vehicle Coordinator will be in touch about collection, drivers, and anything still outstanding before the keys are handed over.`)}
        ${noteHtml}
      `,
      siteUrl,
    });
  }

  return renderEmailShell({
    title: "An update on your vehicle request",
    preheader: "An update on your vehicle request.",
    eyebrow: "Request Update",
    heading: "An update on your request",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(requesterFirstName)}, thank you for your request ${emphasis(escapeHtml(bookingName))} for ${escapeHtml(whenLabel)}. Unfortunately we're not able to approve it this time.`)}
      ${noteHtml}
      ${bodyParagraph(`If the dates are flexible or you have any questions, just reply to this email and we'll see what's possible.`)}
    `,
    siteUrl,
  });
}
