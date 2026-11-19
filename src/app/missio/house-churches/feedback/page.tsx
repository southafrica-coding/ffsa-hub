import type { Metadata } from "next";
import { FeedbackHistory } from "@/components/missio/feedback/history";

export const metadata: Metadata = {
  title: { absolute: "Weekly feedback · Missio" },
};

export default function MissioFeedbackPage() {
  return <FeedbackHistory />;
}
