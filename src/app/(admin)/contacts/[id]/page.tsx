import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getContactById } from "@/services/contacts";
import { getContactLabels } from "@/services/labels";
import { getContactLists, getListsForContact } from "@/services/contact-lists";
import { getCachedActiveLabels } from "@/lib/cached-reads";
import { getContactActivity } from "@/services/activity-events";
import {
  listContactEmails,
  listContactPhones,
} from "@/services/contact-identifiers";
import { getContactDossier } from "@/services/contact-dossier";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { LabelsCard } from "./labels-card";
import { ListsCard } from "./lists-card";
import { IdentifiersCard } from "./identifiers-card";
import { MergeButton } from "./merge-button";
import { Timeline } from "./timeline";
import { ContactDossier } from "./contact-dossier";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: contact, error } = await getContactById(supabase, id);
  if (error || !contact) notFound();

  // contact_emails / contact_phones are RLS-gated on the granular
  // has_permission('contacts.read') grant, whereas the contacts table (and the
  // list view) is gated on roles — so a role-based admin without that explicit
  // permission row reads contacts fine but gets ZERO identifier rows, showing
  // "No email on file" despite data existing. Read identifiers with the admin
  // client (this page is already admin-gated and getContactById above enforces
  // contact visibility), matching how the rest of the app reads these tables.
  const admin = createAdminClient();

  const [
    contactLabelsRes,
    allLabelsRes,
    contactListsRes,
    allListsRes,
    activityRes,
    emailsRes,
    phonesRes,
    dossier,
  ] = await Promise.all([
    getContactLabels(supabase, id),
    getCachedActiveLabels(),
    getListsForContact(supabase, id),
    getContactLists(supabase),
    getContactActivity(supabase, id, { limit: 100 }),
    listContactEmails(admin, id),
    listContactPhones(admin, id),
    getContactDossier(admin, id),
  ]);

  const contactLabels = contactLabelsRes.data ?? [];
  const allLabels = allLabelsRes.data ?? [];
  const contactLists = contactListsRes.data ?? [];
  const allLists = (allListsRes.data ?? []).map(
    (l: { id: string; name: string }) => ({ id: l.id, name: l.name })
  );
  const events = activityRes.data ?? [];
  const emails = emailsRes.data ?? [];
  const phones = phonesRes.data ?? [];

  const personTypes =
    contact.person_type_assignments?.map(
      (pta: { person_types: { name: string; id: string } | null }) =>
        pta.person_types
    ) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/contacts"
          className="text-xs text-muted-foreground hover:text-foreground uppercase tracking-widest"
          style={{ letterSpacing: "0.15em" }}
        >
          ← Contacts
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="page-eyebrow">PEOPLE &amp; RELATIONSHIPS</p>
          <h1 className="page-title">
            {contact.preferred_name ?? contact.first_name} {contact.last_name}
          </h1>
          {contact.preferred_name && (
            <p className="text-sm text-muted-foreground mt-1">
              Legal name: {contact.first_name} {contact.last_name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MarketingStatusBadge status={contact.marketing_status} />
          <Badge variant={contact.status === "active" ? "default" : "outline"} className="capitalize">
            {contact.status}
          </Badge>
          <MergeButton
            sourceContactId={id}
            sourceName={`${contact.preferred_name ?? contact.first_name} ${contact.last_name}`.trim()}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <IdentifiersCard
            contactId={id}
            emails={emails}
            phones={phones}
          />

          <ContactDossier dossier={dossier} />

          {(contact.address_line_1 || contact.city || contact.country) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Address</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">
                  {[
                    contact.address_line_1,
                    contact.address_line_2,
                    [contact.city, contact.province].filter(Boolean).join(", "),
                    contact.postal_code,
                    contact.country,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Demographics</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Date of birth"
                value={contact.date_of_birth ? new Date(contact.date_of_birth).toLocaleDateString() : null}
              />
              <Field label="Gender" value={contact.gender} />
              <Field label="Marital status" value={contact.marital_status} />
              <Field label="Nationality" value={contact.nationality} />
              <Field label="Preferred language" value={contact.preferred_language} />
              <Field label="Preferred channel" value={contact.preferred_channel} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">CRM metadata</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Source" value={contact.source} />
              <Field
                label="Last interaction"
                value={
                  contact.last_interaction_at
                    ? new Date(contact.last_interaction_at).toLocaleString()
                    : null
                }
              />
              <Field
                label="Created"
                value={contact.created_at ? new Date(contact.created_at).toLocaleDateString() : null}
              />
            </CardContent>
          </Card>

          {contact.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
              </CardContent>
            </Card>
          )}

          <Timeline contactId={id} events={events} />
        </div>

        <div className="space-y-6">
          <LabelsCard
            contactId={id}
            contactLabels={contactLabels}
            allLabels={allLabels}
          />

          <ListsCard
            contactId={id}
            contactLists={contactLists}
            allLists={allLists}
          />

          {personTypes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Types</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {personTypes.map(
                    (pt: { id: string; name: string } | null) =>
                      pt && (
                        <Badge key={pt.id} variant="secondary" className="capitalize">
                          {pt.name}
                        </Badge>
                      )
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

function MarketingStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const cls =
    status === "subscribed"
      ? "bg-green-100 text-green-800"
      : status === "unsubscribed_all"
      ? "bg-red-100 text-red-800"
      : status === "bounced"
      ? "bg-orange-100 text-orange-800"
      : "bg-gray-100 text-gray-800";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}
