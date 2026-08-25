import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/services/users";
import { getAttendanceForContact } from "@/services/attendance";
import { redirect } from "next/navigation";
import { Masthead, SectionBar, StatusPill, DateBlock, type Tone } from "@/components/ffsa";

const STATUS_TONE: Record<string, Tone> = {
  present: "good",
  late: "warn",
  excused: "quiet",
  absent: "bad",
};

type AttendanceRow = {
  id: string;
  status: string;
  checked_in_at: string | null;
  events: {
    id: string;
    title: string;
    start_date: string;
    location: string | null;
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

export default async function MyAttendancePage() {
  const supabase = await createClient();
  const { data: user } = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const contactId = user.contact_id;
  const { data: attendance } = contactId
    ? await getAttendanceForContact(supabase, contactId)
    : { data: [] };

  const rows = (attendance ?? []) as AttendanceRow[];
  const present = rows.filter((r) => r.status === "present").length;
  // The screen's one figure: how much of it you actually showed up to.
  const pct = rows.length > 0 ? Math.round((present / rows.length) * 100) : null;

  return (
    <div className="ffsa-screen">
      <Masthead context="Personal" title="My attendance" />

      {pct !== null && (
        <div className="border-b border-ink px-5 py-6 md:px-8 md:py-7">
          <div className="mono-label mb-3">Present</div>
          <div className="flex items-baseline gap-3">
            <span className="numeral text-[52px] leading-none md:text-[64px]">
              {pct}%
            </span>
            <span className="font-mono text-[13px] text-[color:var(--text-tertiary)]">
              {present} of {rows.length}
            </span>
          </div>
        </div>
      )}

      <SectionBar title="Attendance records" meta={`${rows.length} logged`} />

      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center md:px-8">
          <p className="mono-label">
            No attendance records yet — check-ins appear here after your first
            session
          </p>
        </div>
      ) : (
        <ul>
          {rows.map((att) => {
            const start = parseDay(att.events?.start_date);
            return (
              <li
                key={att.id}
                className="flex min-h-[48px] items-center gap-3.5 border-b border-rule px-5 py-3.5 md:px-8"
              >
                <DateBlock day={start.day} mon={start.mon} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold text-ink">
                    {att.events?.title ?? "Event removed"}
                  </div>
                  {/* Line two carries the check-in time when there is one,
                      the location when there isn't — never both, never a
                      third line. */}
                  <div className="mono-label mt-1 truncate">
                    {att.checked_in_at
                      ? `Checked in ${new Date(att.checked_in_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`
                      : (att.events?.location ?? "Location TBC")}
                  </div>
                </div>
                <StatusPill tone={STATUS_TONE[att.status] ?? "quiet"}>
                  {att.status}
                </StatusPill>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
