import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { listMatchQueue } from "@/services/records-library";
import { MatchQueueList } from "./match-queue-list";
import { Masthead } from "@/components/ffsa";

export default async function MatchQueuePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "records-library");

  const queueRes = await listMatchQueue(supabase, { status: "pending" });
  const queue = queueRes.data ?? [];

  return (
    <div className="ffsa-screen">
      <Masthead context="Records library" title="Match queue" />
      <div className="space-y-6 px-5 py-6 md:px-8">
      <div>
        <p className="text-sm text-gray-600">
          These library records partially matched an existing user but
          didn&apos;t meet the auto-link bar. Approve to link, reject to
          dismiss.
        </p>
      </div>
      <MatchQueueList items={queue} />
      </div>
    </div>
  );
}
