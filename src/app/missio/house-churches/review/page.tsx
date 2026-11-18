import type { Metadata } from "next";
import { ReviewQueue } from "@/components/missio/house-churches/review-queue";

export const metadata: Metadata = {
  title: { absolute: "Review names · Missio" },
};

export default function MissioHouseReviewPage() {
  return <ReviewQueue />;
}
