import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { listMatchQueue } from "@/services/records-library";
import { MatchQueueList } from "./match-queue-list";
import { Masthead, MastheadAction } from "@/components/ffsa";

export default async function MatchQueuePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "records-library");

  const queueRes = await listMatchQueue(supabase, { status: "pending" });
  const queue = queueRes.data ?? [];

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Records library · ${queue.length} waiting`}
        title="Match queue"
        actions={<MastheadAction href="/records-library">Library</MastheadAction>}
      />
      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="max-w-3xl text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
          These library records partially matched an existing user but
          didn&apos;t meet the auto-link bar. Approve to link, reject to
          dismiss.
        </p>
        <div className="mt-6">
          <MatchQueueList items={queue} />
        </div>
      </div>
    </div>
  );
}
