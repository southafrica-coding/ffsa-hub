import { Suspense } from "react";
import type { Metadata } from "next";
import { FollowUpBoard } from "@/components/missio/follow-up/board";

export const metadata: Metadata = {
  title: { absolute: "Follow-up · Missio" },
};

export default function MissioFollowUpPage() {
  return (
    <Suspense fallback={<p>Loading follow-up…</p>}>
      <FollowUpBoard />
    </Suspense>
  );
}
