import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { getEvangelismAccess } from "@/lib/auth/check-evangelism-access";
import { present } from "@/lib/evangelism/http";
import { Masthead, MastheadAction, SectionBar } from "@/components/ffsa";
import { isEvangelismNotReady, listTestimonies } from "@/services/evangelism";
import { QueueList, WithheldQueue, showWithheldQueue } from "./queue-list";

export default async function EvangelismQueuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "evangelism");

  const access = await getEvangelismAccess(supabase, user.id);
  if (!access.publish && !access.moderate && !access.unscopedAdmin) redirect("/evangelism");

  const queueAccess = {
    submit: access.submit,
    publish: access.publish,
    moderate: access.moderate,
    unscopedAdmin: access.unscopedAdmin,
  };
  const moderator = showWithheldQueue(queueAccess);
  const caller = { supabase, userId: user.id, access };

  const [{ data, error }, withheld] = await Promise.all([
    listTestimonies(supabase, { status: "submitted", limit: 100 }),
    moderator
      ? listTestimonies(supabase, { status: "withheld", limit: 100 })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const stories = error ? [] : await present(data, caller);
  const withheldStories = withheld.error ? [] : await present(withheld.data, caller);
  const notReady = isEvangelismNotReady(error) || isEvangelismNotReady(withheld.error);

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Evangelism"
        title="Review queue"
        actions={<MastheadAction href="/evangelism">Back to stories</MastheadAction>}
      />
      <SectionBar title="Waiting for review" meta={stories.length ? `${stories.length}` : undefined} />
      {notReady ? (
        <p className="px-5 py-6 text-sm text-[color:var(--text-secondary)] md:px-8">
          The testimonies database hasn&apos;t been set up yet (migration 307).
        </p>
      ) : error ? (
        <p className="px-5 py-6 text-sm text-red-700 md:px-8">Couldn&apos;t load the queue.</p>
      ) : (
        <QueueList stories={stories} access={queueAccess} />
      )}
      {moderator && !notReady && (
        <>
          <SectionBar title="Withheld" meta={withheldStories.length ? `${withheldStories.length}` : undefined} />
          {withheld.error ? (
            <p className="px-5 py-6 text-sm text-red-700 md:px-8">Couldn&apos;t load withheld stories.</p>
          ) : (
            <WithheldQueue stories={withheldStories} access={queueAccess} />
          )}
        </>
      )}
    </div>
  );
}
