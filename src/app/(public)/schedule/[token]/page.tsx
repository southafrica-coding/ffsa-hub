import type { Metadata } from "next";

// The link preview says what this link IS. It deliberately names no
// person: a preview card renders in whatever chat the link was pasted
// into, so pulling the applicant's or recipient's name in here would
// leak them to everyone in the room.
export const metadata: Metadata = {
  title: "Choose an interview time",
  description: "Pick a time that suits you from the available interview slots.",
  openGraph: {
    title: "Choose an interview time",
    description: "Pick a time that suits you from the available interview slots.",
    type: "website",
  },
  // Personal link — never index it.
  robots: { index: false, follow: false },
};

import { createAdminClient } from "@/lib/supabase/admin";
import { getSchedulingRequestByToken } from "@/services/scheduling";
import { SlotPicker } from "./slot-picker";
import { PublicFormNotice } from "@/components/public-form-shell";

function fullName(p: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}): string {
  const first = p.preferred_name || p.first_name || "";
  const last = p.last_name || "";
  return `${first} ${last}`.trim();
}

export default async function SchedulingTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const adminSupabase = createAdminClient();
  const view = await getSchedulingRequestByToken(adminSupabase, token);

  if (!view) {
    return (
      <PublicFormNotice
        eyebrow="Scheduling"
        heading="Invalid link"
        body="This scheduling link is invalid. Please contact the sender for a new link."
      />
    );
  }

  if (view.request.status === "cancelled") {
    return (
      <PublicFormNotice
        eyebrow="Scheduling"
        heading="Cancelled"
        body="This scheduling request has been cancelled."
      />
    );
  }

  if (view.request.status === "scheduled") {
    return (
      <PublicFormNotice
        eyebrow="Scheduling"
        heading="Already confirmed"
        body="A time has already been confirmed for this request — check your email for the calendar invite."
      />
    );
  }

  if (view.request.status === "awaiting_selection") {
    return (
      <PublicFormNotice
        eyebrow="Scheduling"
        heading="Times submitted"
        body="You've already submitted your availability. We'll email you once a time is confirmed."
      />
    );
  }

  if (view.expired) {
    return (
      <PublicFormNotice
        eyebrow="Scheduling"
        heading="Link expired"
        body="This scheduling link has expired. Please reach out to the sender for a new link."
      />
    );
  }

  const recipientFirstName =
    view.contact.preferred_name || view.contact.first_name || "there";
  const senderName = fullName(view.requester) || "Fire & Fragrance South Africa";

  return (
    <SlotPicker
      token={token}
      recipientFirstName={recipientFirstName}
      senderName={senderName}
      durationMinutes={view.request.duration_minutes}
      message={view.request.message}
    />
  );
}
