// The event helper: "Not sure what you need? Tell us about your event."
// The page is a shell; the questions live in HelperForm, which posts to
// /api/public/hire-helper. Dates carry over from the storefront.

import type { Metadata } from "next";
import Link from "next/link";
import { readRange, sastToday } from "@/lib/equipment/dates";
import { HelperForm } from "./helper-form";

export const metadata: Metadata = {
  title: "What do I need? · Hire · Fire & Fragrance",
  description: "Answer a few questions about your event and our team will tell you what sound gear you need.",
};

export default async function HelperPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const today = sastToday();
  const range = readRange(await searchParams, today);

  return (
    <main className="px-[18px] pb-10 pt-8 md:px-14 md:pb-16 md:pt-16">
      <div className="max-w-[820px]">
        <div className="hire-label mb-3">Event helper</div>
        <h1 className="hire-display text-[52px] md:text-[96px]">What do you need?</h1>
        <p className="mt-3 max-w-[560px] text-[16px] leading-relaxed md:text-[18px]">
          Answer a few questions about your event. You don&apos;t need to know any sound terms. Our team will work out
          the gear you need and email you a quote. It takes about three minutes.
        </p>
        <p className="mt-3 text-[15px]">
          Already know what you need?{" "}
          <Link
            href={range.chosen ? `/hire/request?from=${range.from}&to=${range.to}` : "/hire/request"}
            className="font-bold text-[color:var(--hire-accent)]"
          >
            Pick it yourself →
          </Link>
        </p>
        <div className="mt-6 md:mt-10">
          <HelperForm today={today} initialDate={range.chosen ? range.from : ""} initialEndDate={range.chosen && range.to !== range.from ? range.to : ""} />
        </div>
      </div>
    </main>
  );
}
