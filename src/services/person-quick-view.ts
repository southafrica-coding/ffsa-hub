// FFSA Hub — Person quick-view.
//
// Assembles the data for a HubSpot-style "click a person → side panel"
// from anywhere in the Hub. Deliberately CONTACT-CENTRIC and
// application-free: it surfaces identity, delivery-aware email history and
// recent activity, but never touches application_responses — so the panel
// can be shown to anyone with contacts access without exposing a person's
// school application.
//
// Resolution: the same human exists as a users row (login/enrollment) and
// a contacts row (CRM), joined only by email. Given any of
// {contactId, userId, email}, we resolve to a canonical contact. When no
// contact exists (e.g. a public applicant known only by email), we return
// a "lite" panel built from the users row + the email ledger.

import { getContactEmailHistory } from "./contact-email-history";
import { getContactActivity } from "./activity-events";
import { getContactLabels } from "./labels";
import {
  listContactEmails,
  listContactPhones,
  findContactsByEmail,
} from "./contact-identifiers";
import type { ContactEmailItem } from "./contact-email-history";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type QuickViewLabel = {
  id: string;
  name: string;
  color: string | null;
};

export type QuickViewActivity = {
  id: string;
  label: string;
  occurredAt: string | null;
};

export type PersonQuickView = {
  found: boolean;
  /** True when there's no contact record — a thinner, email-only panel. */
  lite: boolean;
  contactId: string | null;
  name: string;
  status: string | null;
  marketingStatus: string | null;
  primaryEmail: string | null;
  emails: string[];
  phones: string[];
  source: string | null;
  createdAt: string | null;
  lastInteractionAt: string | null;
  labels: QuickViewLabel[];
  emailHistory: ContactEmailItem[];
  activity: QuickViewActivity[];
};

export type PersonRef = {
  contactId?: string | null;
  userId?: string | null;
  email?: string | null;
  /** Optional display name so the panel header shows instantly while loading. */
  name?: string | null;
};

const NOT_FOUND: PersonQuickView = {
  found: false,
  lite: false,
  contactId: null,
  name: "Unknown",
  status: null,
  marketingStatus: null,
  primaryEmail: null,
  emails: [],
  phones: [],
  source: null,
  createdAt: null,
  lastInteractionAt: null,
  labels: [],
  emailHistory: [],
  activity: [],
};

const norm = (e: string) => e.trim().toLowerCase();

// Turn an activity_events row into a one-line human summary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeActivity(row: any): string {
  const t: string = row.event_type ?? "";
  const label = row.labels?.name;
  const form = row.forms?.name;
  const campaign = row.campaigns?.name;
  const payload = row.payload ?? {};
  switch (t) {
    case "contact_created":
      return "Contact created";
    case "contact_updated":
      return "Details updated";
    case "contact_merged":
      return "Contact merged";
    case "label_added":
      return label ? `Label added — ${label}` : "Label added";
    case "label_removed":
      return label ? `Label removed — ${label}` : "Label removed";
    case "form_submitted":
      return form ? `Submitted form — ${form}` : "Form submitted";
    case "csv_imported":
      return "Imported from CSV";
    case "note_added":
      return payload.note ? `Note — ${payload.note}` : "Note added";
    case "manual_interaction":
      return payload.summary || "Interaction logged";
    case "event_attended":
      return "Attended an event";
    default:
      if (t.startsWith("email_")) {
        const verb = t.replace("email_", "").replace(/_/g, " ");
        return campaign ? `Email ${verb} — ${campaign}` : `Email ${verb}`;
      }
      return t.replace(/_/g, " ") || "Activity";
  }
}

async function findContactIdByEmail(
  admin: Client,
  email: string
): Promise<string | null> {
  const e = norm(email);
  // Prefer the identifier table (covers secondary emails)…
  const matches = await findContactsByEmail(admin, e);
  if (matches.length > 0) return matches[0].contact_id;
  // …then the primary email column on contacts.
  const { data } = await admin
    .from("contacts")
    .select("id")
    .ilike("email", e)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function resolvePersonQuickView(
  admin: Client,
  ref: PersonRef
): Promise<PersonQuickView> {
  let contactId: string | null = ref.contactId ?? null;
  // Identity fallbacks for the lite panel when no contact is found.
  let liteName: string | null = null;
  let liteEmail: string | null = ref.email ? norm(ref.email) : null;

  // From a user → get their email, then resolve to a contact.
  if (!contactId && ref.userId) {
    const { data: user } = await admin
      .from("users")
      .select("id, first_name, last_name, email")
      .eq("id", ref.userId)
      .maybeSingle();
    if (user) {
      liteName =
        [user.first_name, user.last_name].filter(Boolean).join(" ") ||
        user.email ||
        null;
      if (user.email) liteEmail = norm(user.email);
    }
    if (liteEmail) contactId = await findContactIdByEmail(admin, liteEmail);
  }

  // From a bare email → resolve to a contact.
  if (!contactId && liteEmail) {
    contactId = await findContactIdByEmail(admin, liteEmail);
  }

  // ── Full contact panel ──
  if (contactId) {
    const { data: contact } = await admin
      .from("contacts")
      .select(
        "id, first_name, last_name, preferred_name, email, phone, status, marketing_status, source, created_at, last_interaction_at"
      )
      .eq("id", contactId)
      .maybeSingle();

    if (contact) {
      const [emailsRes, phonesRes, labelsRes, history, activityRes] =
        await Promise.all([
          listContactEmails(admin, contactId),
          listContactPhones(admin, contactId),
          getContactLabels(admin, contactId),
          getContactEmailHistory(admin, contactId),
          getContactActivity(admin, contactId, { limit: 15 }),
        ]);

      const emails = (emailsRes.data ?? []).map(
        (r: { email: string }) => r.email
      );
      const phones = (phonesRes.data ?? []).map(
        (r: { phone: string }) => r.phone
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const labels: QuickViewLabel[] = ((labelsRes.data ?? []) as any[])
        .map((r) => r.labels)
        .filter(Boolean)
        .map((l: { id: string; name: string; color: string | null }) => ({
          id: l.id,
          name: l.name,
          color: l.color ?? null,
        }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activity: QuickViewActivity[] = ((activityRes.data ?? []) as any[]).map(
        (row) => ({
          id: row.id,
          label: describeActivity(row),
          occurredAt: row.occurred_at ?? null,
        })
      );

      const name =
        contact.preferred_name ||
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
        contact.email ||
        "Unknown";

      return {
        found: true,
        lite: false,
        contactId,
        name,
        status: contact.status ?? null,
        marketingStatus: contact.marketing_status ?? null,
        primaryEmail: contact.email ?? emails[0] ?? null,
        emails: emails.length ? emails : contact.email ? [contact.email] : [],
        phones: phones.length ? phones : contact.phone ? [contact.phone] : [],
        source: contact.source ?? null,
        createdAt: contact.created_at ?? null,
        lastInteractionAt: contact.last_interaction_at ?? null,
        labels,
        emailHistory: history,
        activity,
      };
    }
  }

  // ── Lite panel (no contact record) ──
  if (liteEmail) {
    const { data: msgs } = await admin
      .from("email_messages")
      .select("id, category, subject, status, error, sent_at, created_at")
      .ilike("to_email", liteEmail)
      .order("created_at", { ascending: false })
      .limit(25);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emailHistory: ContactEmailItem[] = ((msgs ?? []) as any[]).map(
      (m) => ({
        id: `transactional:${m.id}`,
        channel: "transactional" as const,
        subject:
          m.subject ||
          (m.category
            ? m.category
                .split("_")
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")
            : "Email"),
        context: m.category ?? null,
        status: m.status ?? "sent",
        reason: m.error ?? null,
        sentAt: m.sent_at ?? m.created_at ?? null,
      })
    );

    return {
      ...NOT_FOUND,
      found: true,
      lite: true,
      name: liteName || liteEmail,
      primaryEmail: liteEmail,
      emails: [liteEmail],
      emailHistory,
    };
  }

  return NOT_FOUND;
}
