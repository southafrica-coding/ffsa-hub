import type { Metadata } from "next";

// The link preview says what this link IS. It deliberately names no
// person: a preview card renders in whatever chat the link was pasted
// into, so pulling the applicant's or recipient's name in here would
// leak them to everyone in the room.
export const metadata: Metadata = {
  title: "Unsubscribe",
  description: "Stop receiving these emails from Fire & Fragrance South Africa.",
  openGraph: {
    title: "Unsubscribe",
    description: "Stop receiving these emails from Fire & Fragrance South Africa.",
    type: "website",
  },
  // Personal link — never index it.
  robots: { index: false, follow: false },
};

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /unsubscribe is now an alias for /preferences — the preferences page is the
// unified checkbox UI. Keeping the route around so legacy footer links still
// land on the right place.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const query = t ? `?t=${encodeURIComponent(t)}` : "";
  redirect(`/preferences${query}`);
}
