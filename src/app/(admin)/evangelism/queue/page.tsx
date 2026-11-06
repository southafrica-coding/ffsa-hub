import type { Metadata } from "next";
import { requireEvangelismPage } from "../access";
import { PublishQueue } from "../publish-queue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Evangelism publish queue" };

export default async function EvangelismQueuePage() {
  const user = await requireEvangelismPage();
  return (
    <div className="ffsa-screen">
      <PublishQueue userId={user.id} />
    </div>
  );
}
