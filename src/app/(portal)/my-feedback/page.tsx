import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyHubFeedback, type HubFeedbackRow } from "@/services/hub-feedback";
import { toListItems } from "@/lib/hub-feedback/server";
import { Masthead } from "@/components/ffsa";
import { FeedbackButton } from "@/components/hub-feedback/feedback-button";
import { MyFeedbackList } from "./my-feedback-list";

export default async function MyFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { item } = await searchParams;
  const { data } = await getMyHubFeedback(supabase, user.id);
  const items = await toListItems(supabase, createAdminClient(), (data ?? []) as HubFeedbackRow[], {
    countDuplicates: false,
  });

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Personal · ${items.length} sent`}
        title="My feedback"
        actions={<FeedbackButton variant="masthead" />}
      />
      <p className="border-b border-rule px-5 py-4 text-[14px] text-[color:var(--text-secondary)] md:px-8">
        Problems, ideas and vision you&rsquo;ve sent about the Hub, and where each one is. Not everything gets
        built, but everything gets read.
      </p>
      <MyFeedbackList items={items} initialOpenId={item ?? null} />
    </div>
  );
}
