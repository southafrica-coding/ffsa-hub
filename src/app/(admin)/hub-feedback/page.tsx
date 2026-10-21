import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getHubFeedbackAccess,
  getHubFeedbackAssignees,
  getHubFeedbackBoard,
  type HubFeedbackRow,
} from "@/services/hub-feedback";
import { toListItems } from "@/lib/hub-feedback/server";
import { FeedbackBoard } from "./feedback-board";

export default async function HubFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "hub-feedback");

  const access = await getHubFeedbackAccess(supabase);
  if (!access.canView) redirect("/dashboard");

  const admin = createAdminClient();
  const [{ item }, { data }, assignees] = await Promise.all([
    searchParams,
    getHubFeedbackBoard(supabase),
    access.canTriage ? getHubFeedbackAssignees(admin) : Promise.resolve([]),
  ]);
  const items = await toListItems(supabase, admin, (data ?? []) as HubFeedbackRow[], {
    countDuplicates: true,
  });

  return (
    <FeedbackBoard
      items={items}
      assignees={assignees}
      canTriage={access.canTriage}
      userId={user.id}
      initialOpenId={item ?? null}
    />
  );
}
