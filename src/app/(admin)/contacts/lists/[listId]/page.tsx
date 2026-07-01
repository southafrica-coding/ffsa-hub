import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getContactListById,
  getListMembers,
} from "@/services/contact-lists";
import { MembersTable } from "./members-table";

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
    <div className="space-y-6">
      <div>
        <Link
          href="/contacts/lists"
          className="text-xs text-muted-foreground hover:text-foreground uppercase tracking-widest"
          style={{ letterSpacing: "0.15em" }}
        >
          ← Lists
        </Link>
      </div>
      <div>
        <p className="page-eyebrow">PEOPLE &amp; RELATIONSHIPS</p>
        <h1 className="page-title">{list.name}</h1>
        {list.description && (
          <p className="text-sm text-muted-foreground mt-1">{list.description}</p>
        )}
        <p className="text-sm text-muted-foreground mt-1">
          {members.length} contact{members.length === 1 ? "" : "s"}
        </p>
      </div>

      <MembersTable listId={listId} members={members} />
    </div>
  );
}
