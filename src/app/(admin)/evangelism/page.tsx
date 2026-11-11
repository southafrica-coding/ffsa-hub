import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { getEvangelismAccess } from "@/lib/auth/check-evangelism-access";
import { present } from "@/lib/evangelism/http";
import { Masthead, MastheadAction } from "@/components/ffsa";
import { isEvangelismNotReady, listActiveMinistries, listTestimonies } from "@/services/evangelism";
import { EvangelismBoard } from "./evangelism-board";

export default async function EvangelismPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "evangelism");

  const access = await getEvangelismAccess(supabase, user.id);
  if (!access.view) redirect("/home");
  const caller = { supabase, userId: user.id, access };

  const [published, mine, ministries] = await Promise.all([
    listTestimonies(supabase, { status: "published", limit: 100 }),
    access.submit ? listTestimonies(supabase, { mine: true, limit: 100 }) : Promise.resolve(null),
    access.submit ? listActiveMinistries(supabase) : Promise.resolve([]),
  ]);

  const masthead = (
    <Masthead
      context="Sharing the gospel"
      title="Evangelism"
      actions={access.publish ? <MastheadAction href="/evangelism/queue">Review queue</MastheadAction> : undefined}
    />
  );

  if (isEvangelismNotReady(published.error) || isEvangelismNotReady(mine?.error)) {
    return (
      <div className="ffsa-screen">
        {masthead}
        <div className="px-5 py-12 md:px-8">
          <div className="mono-label mb-3">Not switched on yet</div>
          <p className="max-w-xl text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
            The testimonies database hasn&apos;t been set up yet (migration 307). Stories will appear here once it
            has.
          </p>
        </div>
      </div>
    );
  }

  const [publishedOut, mineOut] = await Promise.all([
    present(published.data, caller),
    mine ? present(mine.data, caller) : Promise.resolve([]),
  ]);

  return (
    <div className="ffsa-screen">
      {masthead}
      <EvangelismBoard
        published={publishedOut}
        mine={access.submit ? mineOut : null}
        access={{
          submit: access.submit,
          publish: access.publish,
          moderate: access.moderate,
          unscopedAdmin: access.unscopedAdmin,
        }}
        ministries={ministries}
      />
    </div>
  );
}
