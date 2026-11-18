import { notFound } from "next/navigation";
import { AvailabilityStatus, PublicAvailabilityForm } from "@/components/missio/availability/public-form";
import { emptyPublicView, filledPublicView } from "@/lib/missio/availability/fixtures";
import { availabilityPreviewEnabled } from "@/lib/missio/availability/preview";

export const dynamic = "force-dynamic";

export default async function ServePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (!availabilityPreviewEnabled()) notFound();
  const { state } = await searchParams;
  if (state === "expired") return <AvailabilityStatus state="expired" />;
  if (state === "invalid") return <AvailabilityStatus state="invalid" />;
  const view = state === "filled" ? filledPublicView() : emptyPublicView();
  return <PublicAvailabilityForm token="preview" view={view} />;
}
