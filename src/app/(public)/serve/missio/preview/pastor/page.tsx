import { notFound } from "next/navigation";
import { PastorAvailabilityPreview } from "@/components/missio/availability/pastor-preview";
import { availabilityPreviewEnabled } from "@/lib/missio/availability/preview";

export const dynamic = "force-dynamic";

export default async function PastorGridPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ long?: string }>;
}) {
  if (!availabilityPreviewEnabled()) notFound();
  const { long } = await searchParams;
  return <PastorAvailabilityPreview longName={long === "1"} />;
}
