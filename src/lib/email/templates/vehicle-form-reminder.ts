import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

// Sent to the requester at the start of the collection day (sign-out form) and
// the start of the return day (sign-in form). Replaces the two Google Forms —
// the CTA deep-links straight into the matching form on the booking.
export function vehicleFormReminderEmailHtml({
  requesterFirstName,
  bookingName,
  kind,
  dateLabel,
  vehicleLabel,
  formUrl,
  siteUrl,
}: {
  requesterFirstName: string;
  bookingName: string;
  kind: "collection" | "return";
  dateLabel: string;
  vehicleLabel: string | null;
  formUrl: string;
  siteUrl: string;
}): string {
  const vehicleHtml = vehicleLabel
    ? bodyParagraph(`${emphasis("Vehicle:")} ${escapeHtml(vehicleLabel)}`)
    : "";

  if (kind === "collection") {
    return renderEmailShell({
      title: "Complete your vehicle sign-out form",
      preheader: "Fill in the sign-out form before you take the vehicle.",
      eyebrow: "Collection Day",
      heading: "Time to sign the vehicle out",
      bodyHtml: `
        ${bodyParagraph(`Hi ${escapeHtml(requesterFirstName)}, you're collecting the vehicle for ${emphasis(escapeHtml(bookingName))} today (${escapeHtml(dateLabel)}).`)}
        ${vehicleHtml}
        ${bodyParagraph(`Before you drive off, please complete the sign-out form: mileage, a walk-around noting any existing damage, and the items that should be in the vehicle. Anything you don't mark as damaged is treated as undamaged when you took it.`)}
        ${bodyParagraph(`Every driver should be present while you fill it in.`)}
      `,
      notice: {
        label: "Before you drive",
        html: "Make sure each driver's licence is on the booking, and check the jack, wheel spanner, warning triangle, two vests and the spare tyre.",
      },
      cta: { label: "Open the sign-out form", url: formUrl },
      siteUrl,
    });
  }

  return renderEmailShell({
    title: "Complete your vehicle sign-in form",
    preheader: "Fill in the sign-in form when you return the vehicle.",
    eyebrow: "Return Day",
    heading: "Time to sign the vehicle back in",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(requesterFirstName)}, the vehicle for ${emphasis(escapeHtml(bookingName))} is due back today (${escapeHtml(dateLabel)}).`)}
      ${vehicleHtml}
      ${bodyParagraph(`Please complete the sign-in form when you hand the keys back — closing mileage, and confirmation that the vehicle has been washed and refuelled.`)}
      ${bodyParagraph(`Every driver should be present while you fill it in.`)}
    `,
    notice: {
      label: "Bring with the keys",
      html: "The carwash receipt and a photo of the fuel gauge — both are uploaded on the form. The vehicle should be washed inside and out, and returned with a full tank of the correct fuel.",
    },
    cta: { label: "Open the sign-in form", url: formUrl },
    siteUrl,
  });
}
