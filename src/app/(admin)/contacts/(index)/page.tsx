import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getContacts,
  findContactsByIdentifier,
  type ContactSort,
  type IdentifierHit,
} from "@/services/contacts";
import { getContactLists } from "@/services/contact-lists";
import { getLabels, getLabelCounts } from "@/services/labels";
import { Masthead, MastheadAction } from "@/components/ffsa";
import {
  ContactsDirectory,
  type DirectoryContact,
  type DirectoryLabel,
  type MatchNote,
} from "../contacts-directory";
import { ContactsTabsNav } from "../contacts-tabs-nav";
import {
  getAccessibleEventIdsForFollowups,
  userCanAccessFollowupQueue,
} from "@/lib/auth/check-followup-access";
import { getFollowupQueue } from "@/services/event-followup";

const VALID_SORTS: ContactSort[] = [
  "newest",
  "oldest",
  "name_asc",
  "name_desc",
  "recent",
];

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
  const labelId = params.label;
  const sort: ContactSort = VALID_SORTS.includes(params.sort as ContactSort)
    ? (params.sort as ContactSort)
    : "newest";
  const page = parseInt(params.page ?? "1", 10);
  const pageSize = 25;

  // Frame 35a: "matches any email or phone a person has ever had rather than
  // the one on file". That means resolving identifiers BEFORE the main query,
  // so the ids can be OR-ed into it — contacts.email / contacts.phone are only
  // the cached primaries.
  let identifierHits: IdentifierHit[] = [];
  let matchCapped = false;
  if (search && search.trim().length >= 2) {
    const found = await findContactsByIdentifier(supabase, search.trim());
    identifierHits = found.hits;
    matchCapped = found.capped;
  }

  const [contactsResult, listsResult, labelsResult, labelCounts, activeResult, canAccessFollowup] =
    await Promise.all([
      getContacts(supabase, {
        status,
        search,
        labelId,
        sort,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        identifierMatchIds: identifierHits.map((h) => h.contactId),
      }),
      getContactLists(supabase),
      getLabels(supabase, { active: true }),
      getLabelCounts(supabase),
      // The sidebar's headline figure is "everyone", independent of whatever
      // filter is currently applied — otherwise it just repeats the row count.
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      userCanAccessFollowupQueue(supabase, user.id),
    ]);

  const { data: rawContacts, count } = contactsResult;

  const contacts: DirectoryContact[] = (
    (rawContacts ?? []) as Array<Record<string, unknown>>
  ).map((c) => ({
    ...(c as unknown as DirectoryContact),
    emailCount: (c.contact_emails as Array<{ count: number }> | undefined)?.[0]?.count ?? 0,
    phoneCount: (c.contact_phones as Array<{ count: number }> | undefined)?.[0]?.count ?? 0,
  }));

  const lists = (listsResult.data ?? []).map(
    (l: { id: string; name: string }) => ({ id: l.id, name: l.name })
  );

  const labels: DirectoryLabel[] = (
    (labelsResult.data ?? []) as Array<{ id: string; name: string; color: string | null }>
  )
    .map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      count: labelCounts.get(l.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // What the search matched on. Prefer a NON-primary hit: "she is in here under
  // an address she stopped using" is the fact worth reporting, and the whole
  // reason the identifier tables are searched at all. Only ever describes a
  // person actually present in the current results.
  let matchNote: MatchNote | null = null;
  if (search && identifierHits.length > 0) {
    const visible = new Set(contacts.map((c) => c.id));
    const candidates = identifierHits.filter((h) => visible.has(h.contactId));
    const hit = candidates.find((h) => !h.isPrimary) ?? candidates[0];
    if (hit) {
      const c = contacts.find((x) => x.id === hit.contactId);
      if (c) {
        const emails = c.emailCount ?? 0;
        const phones = c.phoneCount ?? 0;
        matchNote = {
          contactId: c.id,
          name: c.preferred_name
            ? `${c.preferred_name} ${c.last_name}`
            : `${c.first_name} ${c.last_name}`,
          kind: hit.kind,
          position: hit.position,
          isPrimary: hit.isPrimary,
          reach: [
            c.email ?? c.phone ?? hit.value,
            `${emails} email${emails === 1 ? "" : "s"}, ${phones} phone${phones === 1 ? "" : "s"} on file`,
          ].join(" · "),
        };
      }
    }
  }

  // Follow-up pending count for the tab badge (null = user has no access)
  let pendingCount: number | null = null;
  if (canAccessFollowup) {
    const accessible = await getAccessibleEventIdsForFollowups(supabase, user.id);
    const queue = await getFollowupQueue(supabase, {
      accessibleEventIds: accessible,
    });
    pendingCount = queue.filter((r) => !r.assigned_staff_id || r.is_unread).length;
  }

  return (
    <div className="ffsa-screen flex min-h-0 flex-1 flex-col">
      <Masthead
        context="People & relationships"
        title="Contacts"
        actions={<MastheadAction href="/contacts/new">Add a contact</MastheadAction>}
      />

      <ContactsTabsNav followupPendingCount={pendingCount} />

      <ContactsDirectory
        contacts={contacts}
        labels={labels}
        lists={lists}
        totalCount={count ?? 0}
        activeCount={activeResult.count ?? 0}
        currentPage={page}
        pageSize={pageSize}
        searchQuery={search}
        statusFilter={status}
        labelFilter={labelId}
        sort={sort}
        matchNote={matchNote}
        matchCapped={matchCapped}
      />
    </div>
  );
}
