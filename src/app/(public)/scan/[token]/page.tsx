import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveScanLink } from "@/services/event-scan-links";
import { PublicFormNotice } from "@/components/public-form-shell";
import { PublicDoorScanner } from "./door-scanner";

export const dynamic = "force-dynamic";

// Never let a door link be indexed or previewed with real content: the token
// IS the credential, so a crawler that finds one shouldn't hand it on.
export const metadata: Metadata = {
  title: "Ticket scanner · FFSA",
  robots: { index: false, follow: false },
};

export default async function PublicScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await resolveScanLink(createAdminClient(), token);

  if (!link) {
    return (
      <PublicFormNotice
        eyebrow="TICKETS"
        heading="This scanning link isn't active"
        body="It may have been replaced, switched off, or the event has passed. Ask the event organiser to send you a current one."
      />
    );
  }

  return (
    <PublicDoorScanner
      token={token}
      eventTitle={link.event.title}
    />
  );
}
