import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getContactLists } from "@/services/contact-lists";
import { ContactsTabsNav } from "../../contacts-tabs-nav";
import { Masthead } from "@/components/ffsa";
import { ListsManager } from "../lists-manager";

type ListWithCount = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
  contact_list_members: { count: number }[];
};

export default async function ContactListsPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "contacts");

  const { data } = await getContactLists(supabase);

  const lists = ((data ?? []) as ListWithCount[]).map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    color: l.color,
    memberCount: l.contact_list_members?.[0]?.count ?? 0,
  }));

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`People & relationships \u00b7 ${lists.length} list${lists.length === 1 ? "" : "s"}`}
        title="Contacts"
      />

      <ContactsTabsNav followupPendingCount={null} />

      <div className="px-5 py-6 md:px-8 md:py-7">
        <ListsManager lists={lists} />
      </div>
    </div>
  );
}
