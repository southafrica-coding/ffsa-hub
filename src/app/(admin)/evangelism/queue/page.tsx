import type { Metadata } from "next";
import { requireEvangelismPage } from "../access";
import { PublishQueue } from "../publish-queue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Evangelism publish queue" };

// Real queue. Do not redirect this route while evangelism is hidden from the menu.
export default async function EvangelismQueuePage() {
  const user = await requireEvangelismPage();
  return (
    <div className="ffsa-screen">
      <PublishQueue userId={user.id} />
    </div>
  );
}
