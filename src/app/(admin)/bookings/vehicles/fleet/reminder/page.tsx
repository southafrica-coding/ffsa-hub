import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, SectionBar } from "@/components/ffsa";
import { requireFleet } from "@/lib/fleet/load";
import { canSendFleetReminder, fleetDigestBlocks, runFleetReminder } from "@/lib/fleet/reminder-send";
import { REMINDER_SECTIONS, fmtDate, todayInSA } from "@/lib/fleet/rules";
import { getFleetReminderSends } from "@/services/fleet";
import { FLEET } from "../_components/ui";

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const field = "min-h-11 border border-rule-strong bg-white px-3 py-2 text-[15px] focus:border-ink focus:outline-none";

// Admins: what the 07:00 reminder says on any date, and who it goes to, without sending
// anything (HUB-PLAN.md PR 4). Also shows the last days it went out.
export default async function ReminderPreview({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const supabase = await createClient();
  const { access } = await requireFleet(supabase);
  if (!access.isAdmin) redirect(FLEET);
  const { date: qd } = await searchParams;
  const date = isDate(qd) ? qd! : todayInSA();

  const run = await runFleetReminder(supabase, { date, send: false });
  const r = run.reminder;
  const live = canSendFleetReminder();
  const { data: sends } = await getFleetReminderSends(supabase);
  const channels = [run.notify.email && "email", run.notify.slack && "Slack (inside the 07:00 vehicles message)"].filter(Boolean).join(" and ") || "nothing (both switched off on the Schedule page)";
  const slack = fleetDigestBlocks(run);

  return (
    <>
      <Masthead context="Fleet · 07:00 reminder" title="Reminder preview" />
      <div className="space-y-5 px-5 py-6 md:px-8">
        <form className="flex flex-wrap items-end gap-2" action="">
          <label className="grid gap-1.5">
            <span className="mono-label">Date</span>
            <input className={field} type="date" name="date" defaultValue={date} />
          </label>
          <button className="inline-flex min-h-11 items-center border border-ink bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white">
            Show
          </button>
        </form>
        <p className="text-[14px] text-[#55524A]">
          Sent every day at 07:00 to whoever holds the Vehicle Coordinator role, by {channels}. Nothing is sent when every section is empty. This page never sends anything.{" "}
          {live ? "Sending is on for this site." : "Sending is off: Fleet sends no email or Slack messages until it’s switched on (FLEET_MESSAGES_ENABLED on the live Hub)."}
        </p>
      </div>

      <SectionBar title={fmtDate(date)} meta={r.empty ? "Nothing to send" : undefined} />
      {r.empty ? (
        <p className="px-5 py-4 text-[14px] md:px-8">Every section is empty, so no reminder goes out for this day.</p>
      ) : (
        <div className="space-y-4 px-5 py-5 md:px-8">
          <p className="text-[15px]">
            <span className="mono-label mr-2">Subject</span>
            {r.subject}
          </p>
          {REMINDER_SECTIONS.filter(([k]) => r.sections[k].length).map(([k, title]) => (
            <div key={k}>
              <h3 className="font-display text-[16px] font-black uppercase">{title}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px]">
                {r.sections[k].map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <SectionBar title="Slack at 07:00" meta="FFSA Hub Activity" />
      <div className="space-y-3 px-5 py-4 text-[14px] md:px-8">
        <p className="text-[#55524A]">
          Fleet’s part of the 07:00 vehicles message. Under BOOKINGS it adds clashes and today’s pre- and post-trip checks; FLEET lists every vehicle, IN with what’s due on it, or OUT with only who has it.
        </p>
        <h3 className="font-display text-[16px] font-black uppercase">Bookings</h3>
        <pre className="whitespace-pre-wrap break-words bg-bone p-3 text-[12px]">{slack.bookingParts.join("\n\n") || "Nothing from Fleet. The bookings lines (pickups, returns, overdue…) are added when it’s sent."}</pre>
        <h3 className="font-display text-[16px] font-black uppercase">Fleet</h3>
        <pre className="whitespace-pre-wrap break-words bg-bone p-3 text-[12px]">{slack.fleetParts.slice(1).join("\n\n")}</pre>
      </div>

      <SectionBar title="Goes to" />
      <div className="px-5 py-4 text-[14px] md:px-8">
        {run.coordinators.length ? (
          <ul className="space-y-1">
            {run.coordinators.map((c) => (
              <li key={c.userId}>
                {c.name || "(no name)"} · {c.email || "no email address"} · {c.slackUserId ? "Slack linked" : "Slack not linked (link it on their Hub profile)"}
              </li>
            ))}
          </ul>
        ) : (
          <p>No one has the Vehicle Coordinator role yet, so nothing would be sent. Give the role to someone in Users &amp; Roles.</p>
        )}
      </div>

      <SectionBar title="Last sent" />
      <div className="px-5 py-4 text-[14px] md:px-8">
        {sends && sends.length ? (
          <ul className="divide-y divide-rule">
            {sends.map((s: { date: string; subject: string; recipients: { name: string; email: string; slack: string }[] }) => (
              <li key={s.date} className="py-2">
                <Link href={`?date=${s.date}`} className="underline">
                  {fmtDate(s.date)}
                </Link>{" "}
                · {s.subject}
                <span className="block text-[12px] text-[#55524A]">{(s.recipients || []).map((x) => `${x.name}: email ${x.email}, Slack ${x.slack}`).join(" · ") || "—"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[#55524A]">Not sent from the Hub yet.</p>
        )}
      </div>
    </>
  );
}
