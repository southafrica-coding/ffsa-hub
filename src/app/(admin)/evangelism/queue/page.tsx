import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { getEvangelismAccess } from "@/lib/auth/check-evangelism-access";
import { present } from "@/lib/evangelism/http";
import { Masthead, MastheadAction, SectionBar } from "@/components/ffsa";
import { isEvangelismNotReady, listTestimonies } from "@/services/evangelism";
import { QueueList } from "./queue-list";

export default async function EvangelismQueuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "evangelism");

  const access = await getEvangelismAccess(supabase, user.id);
  if (!access.publish) redirect("/evangelism");

  const { data, error } = await listTestimonies(supabase, { status: "submitted", limit: 100 });
  const stories = error ? [] : await present(data, { supabase, userId: user.id, access });

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Evangelism"
        title="Review queue"
        actions={<MastheadAction href="/evangelism">Back to stories</MastheadAction>}
      />
      <SectionBar title="Waiting for review" meta={stories.length ? `${stories.length}` : undefined} />
      {error && isEvangelismNotReady(error) ? (
        <p className="px-5 py-6 text-sm text-[color:var(--text-secondary)] md:px-8">
          The testimonies database hasn&apos;t been set up yet (migration 307).
        </p>
      ) : error ? (
        <p className="px-5 py-6 text-sm text-red-700 md:px-8">Couldn&apos;t load the queue.</p>
      ) : (
        <QueueList
        stories={stories}
        access={{
          submit: access.submit,
          publish: access.publish,
          moderate: access.moderate,
          unscopedAdmin: access.unscopedAdmin,
        }}
      />
      )}
    </div>
  );
}
