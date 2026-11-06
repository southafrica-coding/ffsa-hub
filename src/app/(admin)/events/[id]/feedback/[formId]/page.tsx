import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, StatusPill, type Tone } from "@/components/ffsa";
import {
  getFeedbackFormById,
  listFeedbackResponses,
  listFeedbackSends,
} from "@/services/event-feedback";
import { getEventRoles } from "@/services/event-roles";
import { parseFeedbackSchema } from "@/lib/feedback/schema";
import { FeedbackBuilder, type FeedbackFormMeta } from "./feedback-builder";
import { SharePanel, type RosterPerson, type SendRow } from "./share-panel";

const STATUS_TONE: Record<string, Tone> = {
  draft: "quiet",
  open: "good",
  closed: "warn",
};

type RoleRow = {
  role_name: string;
  display_name: string | null;
  users: { first_name: string | null; last_name: string | null; email: string | null } | null;
  contacts: { first_name: string | null; last_name: string | null; email: string | null } | null;
};

/**
 * The roster, reduced to people we can actually email. Volunteers added by
 * name only have no address, so they're left out of the picker rather than
 * shown as un-selectable noise — the QR is how they get asked.
 */
function rosterRecipients(roles: RoleRow[]): RosterPerson[] {
  const byEmail = new Map<string, RosterPerson>();
  for (const r of roles) {
    const person = r.users ?? r.contacts;
    const email = person?.email?.trim().toLowerCase();
    if (!email) continue;
    const name =
      `${person?.first_name ?? ""} ${person?.last_name ?? ""}`.trim() ||
      r.display_name ||
      email;
    // One person can hold two roles; the first wins and the email dedupes.
    if (!byEmail.has(email)) byEmail.set(email, { name, email, role: r.role_name });
  }
  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default async function FeedbackFormPage({
  params,
}: {
  params: Promise<{ id: string; formId: string }>;
}) {
  const { id: eventId, formId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: form } = await getFeedbackFormById(supabase, formId);
  if (!form || form.event_id !== eventId) notFound();

  const [{ data: roles }, { data: sends }, { data: responses }] = await Promise.all([
    getEventRoles(supabase, eventId),
    listFeedbackSends(supabase, formId),
    listFeedbackResponses(supabase, formId),
  ]);

  const event = (form.events ?? null) as { title?: string } | null;
  const responseRows = (responses ?? []) as { respondent_email: string | null }[];

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`${event?.title ?? "Event"} · post-event feedback`}
        title={form.title}
        actions={
          <>
            <StatusPill tone={STATUS_TONE[form.status] ?? "quiet"}>
              {form.status === "open"
                ? "Open"
                : form.status === "closed"
                  ? "Closed"
                  : "Draft"}
            </StatusPill>
            <Link
              href={`/events/${eventId}/feedback/${formId}/responses`}
              className="mono-label"
            >
              Results ({responseRows.length}) →
            </Link>
            <Link href={`/events/${eventId}?tab=feedback`} className="mono-label">
              Event →
            </Link>
          </>
        }
      />

      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
        <FeedbackBuilder
          eventId={eventId}
          form={form as FeedbackFormMeta}
          initialSchema={parseFeedbackSchema(form.schema)}
          responseCount={responseRows.length}
        />

        <SharePanel
          eventId={eventId}
          formId={formId}
          slug={form.slug}
          formTitle={form.title}
          status={form.status}
          isAnonymous={form.is_anonymous}
          roster={rosterRecipients((roles ?? []) as RoleRow[])}
          sends={(sends ?? []) as SendRow[]}
          respondentEmails={responseRows
            .map((r) => r.respondent_email)
            .filter((e): e is string => !!e)}
        />
      </div>
    </div>
  );
}
