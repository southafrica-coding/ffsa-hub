import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getContactListById,
  getListMembers,
} from "@/services/contact-lists";
import { MembersTable } from "./members-table";
import { Masthead, MastheadAction } from "@/components/ffsa";

type MemberRow = {
  added_at: string;
  contacts: {
    id: string;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    email: string | null;
    phone: string | null;
    status: string;
  } | null;
};

export default async function ContactListDetailPage({
  params,
}: {
  params: Promise<{ listId: string }>;
}) {
  const { listId } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "contacts");

  const [listRes, membersRes] = await Promise.all([
    getContactListById(supabase, listId),
    getListMembers(supabase, listId),
  ]);

  const list = listRes.data;
  if (!list) notFound();

  const members = ((membersRes.data ?? []) as MemberRow[])
    .filter((m) => m.contacts)
    .map((m) => ({ ...m.contacts!, added_at: m.added_at }));

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`List \u00b7 ${members.length} contact${members.length === 1 ? "" : "s"}`}
        title={list.name}
        actions={<MastheadAction href="/contacts/lists">All lists</MastheadAction>}
      />

      {list.description && (
        <p className="border-b border-rule px-5 py-4 text-[14px] text-[color:var(--text-secondary)] md:px-8">
          {list.description}
        </p>
      )}

      <div className="px-5 py-6 md:px-8 md:py-7">
        <MembersTable listId={listId} members={members} />
      </div>
    </div>
  );
}
