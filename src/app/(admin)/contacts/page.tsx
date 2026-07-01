import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getContacts, type ContactSort } from "@/services/contacts";
import { getContactLists } from "@/services/contact-lists";
import { getCachedPersonTypes } from "@/lib/cached-reads";

const VALID_SORTS: ContactSort[] = [
  "newest",
  "oldest",
  "name_asc",
  "name_desc",
  "recent",
];
import { ContactsList } from "./contacts-list";
import { ContactsTabsNav } from "./contacts-tabs-nav";
import {
  getAccessibleEventIdsForFollowups,
  userCanAccessFollowupQueue,
} from "@/lib/auth/check-followup-access";
import { getFollowupQueue } from "@/services/event-followup";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  // Middleware already validated; read session from cookie instead of round-tripping.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "contacts");

  const status = params.status ?? "active";
  const search = params.search;
  const sort: ContactSort = VALID_SORTS.includes(params.sort as ContactSort)
    ? (params.sort as ContactSort)
    : "newest";
  const page = parseInt(params.page ?? "1", 10);
  const pageSize = 25;

  // Run the three independent queries concurrently instead of sequentially.
  // Cuts ~200ms off the contacts page render (was waterfall).
  const [contactsResult, personTypesResult, listsResult, canAccessFollowup] =
    await Promise.all([
      getContacts(supabase, {
        status,
        search,
        sort,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
      getCachedPersonTypes(),
      getContactLists(supabase),
      userCanAccessFollowupQueue(supabase, user.id),
    ]);

  const { data: contacts, count } = contactsResult;
  const { data: personTypes } = personTypesResult;
  const lists = (listsResult.data ?? []).map(
    (l: { id: string; name: string }) => ({ id: l.id, name: l.name })
  );

  // Follow-up pending count for the tab badge (null = user has no access)
  let pendingCount: number | null = null;
  if (canAccessFollowup) {
    const accessible = await getAccessibleEventIdsForFollowups(
      supabase,
      user.id
    );
    const queue = await getFollowupQueue(supabase, {
      accessibleEventIds: accessible,
    });
    pendingCount = queue.filter(
      (r) => !r.assigned_staff_id || r.is_unread
    ).length;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="page-eyebrow">PEOPLE &amp; RELATIONSHIPS</p>
          <h1 className="page-title">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">{count ?? 0} contacts</p>
        </div>
        <div className="flex gap-2">
          <a
            href="/contacts/import"
            className="inline-flex items-center px-3 py-1.5 rounded border text-sm hover:bg-gray-50"
          >
            Import CSV
          </a>
        </div>
      </div>

      <ContactsTabsNav followupPendingCount={pendingCount} />

      <ContactsList
        contacts={contacts ?? []}
        personTypes={personTypes ?? []}
        lists={lists}
        totalCount={count ?? 0}
        currentPage={page}
        pageSize={pageSize}
        searchQuery={search}
        statusFilter={status}
        sort={sort}
      />
    </div>
  );
}
