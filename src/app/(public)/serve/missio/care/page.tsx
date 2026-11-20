import type { Metadata } from "next";
import { CareForm } from "@/components/missio/care/care-form";

export const metadata: Metadata = {
  title: { absolute: "How can we stand with you? · Missio" },
  description: "Ask Missio for prayer, someone to talk to, or practical help.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function MissioCarePage() {
  return <CareForm />;
}
