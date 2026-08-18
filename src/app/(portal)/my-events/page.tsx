import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/services/users";
import { getRegistrationsForContact } from "@/services/registrations";
import { redirect } from "next/navigation";
import { Masthead, SectionBar, StatusPill, DateBlock, type Tone } from "@/components/ffsa";

// Frame 4d: the portal is phone-first, so these personal lists are two-line
// rows rather than a table — a four-column table on a 375px screen is a
// third line by another name.

const STATUS_TONE: Record<string, Tone> = {
  confirmed: "good",
  pending: "warn",
  waitlisted: "quiet",
  cancelled: "bad",
};

type Registration = {
  id: string;
  status: string;
  events: {
    id: string;
    title: string;
    start_date: string;
    end_date: string | null;
    location: string | null;
    status: string;
  } | null;
};

function parseDay(dateStr: string | undefined): { day: string; mon: string } {
  if (!dateStr) return { day: "—", mon: "" };
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return { day: "—", mon: "" };
  return {
    day: String(d.getDate()).padStart(2, "0"),
    mon: d.toLocaleDateString("en-ZA", { month: "short" }).toUpperCase(),
  };
}

export default async function MyEventsPage() {
  const supabase = await createClient();
  const { data: user } = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const contactId = user.contact_id;
  const { data: registrations } = contactId
    ? await getRegistrationsForContact(supabase, contactId)
    : { data: [] };

  const rows = (registrations ?? []) as Registration[];
  const today = new Date().toISOString().split("T")[0];
  const upcoming = rows.filter((r) => (r.events?.start_date ?? "") >= today).length;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Personal · ${rows.length} ${rows.length === 1 ? "registration" : "registrations"}`}
        title="My events"
      />

      <SectionBar
        title="Registrations"
        meta={upcoming > 0 ? `${upcoming} still to come` : undefined}
      />

      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center md:px-8">
          <p className="mono-label">
            No event registrations yet — the events you sign up for land here
          </p>
        </div>
      ) : (
        <ul>
          {rows.map((reg) => {
            const start = parseDay(reg.events?.start_date);
            return (
              <li
                key={reg.id}
                className="flex min-h-[48px] items-center gap-3.5 border-b border-rule px-5 py-3.5 md:px-8"
              >
                <DateBlock day={start.day} mon={start.mon} />
                <div className="min-w-0 flex-1">
                  {/* Line one. */}
                  <div className="truncate text-[15px] font-bold text-ink">
                    {reg.events?.title ?? "Event removed"}
                  </div>
                  {/* Line two — location and nothing more. */}
                  <div className="mono-label mt-1 truncate">
                    {reg.events?.location ?? "Location TBC"}
                  </div>
                </div>
                <StatusPill tone={STATUS_TONE[reg.status] ?? "quiet"}>
                  {reg.status}
                </StatusPill>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
