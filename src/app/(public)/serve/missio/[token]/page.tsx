import type { Metadata } from "next";
import { headers } from "next/headers";
import { AvailabilityStatus, PublicAvailabilityForm } from "@/components/missio/availability/public-form";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { adminClient, loadPublicAvailability } from "@/lib/missio/availability/service";
import { AVAILABILITY_TOKEN_PATTERN, hashAvailabilityToken } from "@/lib/missio/availability/token";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Serving · Missio" },
  description: "Mark the Sundays you can serve.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ServeMissioPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  const forwarded = new Headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const realIp = headerList.get("x-real-ip");
  if (forwardedFor) forwarded.set("x-forwarded-for", forwardedFor);
  if (realIp) forwarded.set("x-real-ip", realIp);
  const tokenHash = AVAILABILITY_TOKEN_PATTERN.test(token) ? hashAvailabilityToken(token) : undefined;
  const limited = await serveAvailabilityLimit(new Request("http://internal.local/serve", { headers: forwarded }), "read", tokenHash);
  if (limited) return <AvailabilityStatus state="limited" />;

  try {
    const result = await loadPublicAvailability(adminClient(), token);
    if (!result.ok) {
      if (result.code === "expired") return <AvailabilityStatus state="expired" />;
      if (result.code === "invalid_token") return <AvailabilityStatus state="invalid" />;
      return <AvailabilityStatus state="unavailable" />;
    }
    return <PublicAvailabilityForm token={token} view={result.body} />;
  } catch (error) {
    console.error("[serve/missio]", error instanceof Error ? error.message : "lookup failed");
    return <AvailabilityStatus state="unavailable" />;
  }
}
