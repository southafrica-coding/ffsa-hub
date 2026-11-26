import Link from "next/link";
import { notFound } from "next/navigation";
import { Masthead, SectionBar, StatusPill } from "@/components/ffsa";
import { STATUS_LABEL, STATUS_TONE, areaLabel, isStatus } from "@/lib/operations/areas";
import { toItem } from "@/lib/operations/change";
import { dayLabel, dueWords, sastDate } from "@/lib/operations/dates";
import { getItem, getItemUpdates } from "@/services/operations";
import { opsContext } from "../../context";
import { MAINT_LABEL, maintStatus, urgencyLabel, whatsappText } from "@/lib/operations/maintenance";
import { CopyButton, ItemUpdateForm } from "../../ops-forms";

export const dynamic = "force-dynamic";

type UpdateRow = {
  id: string;
  kind: string;
  status_to: string | null;
  due_to: string | null;
  note: string | null;
  via: string;
  author_name: string | null;
  created_at: string;
  author: { display_name: string | null } | null;
  owner: { display_name: string | null } | null;
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

function describe(u: UpdateRow): string {
  switch (u.kind) {
    case "created":
      return u.via === "slack" ? "sent it in through the Slack form" : u.via === "meeting" ? "added it at the meeting" : "added it";
    case "status":
      return `marked it ${isStatus(u.status_to) ? STATUS_LABEL[u.status_to].toLowerCase() : u.status_to}`;
    case "assign":
      return u.owner?.display_name ? `gave it to ${u.owner.display_name}` : "took it off whoever had it";
    case "due":
      return u.due_to ? `set the date to ${dayLabel(u.due_to)}` : "cleared the date";
    default:
      return "added a note";
  }
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Not team-only: the person a task was given to can open it (RLS decides).
  const { supabase, isTeam, people } = await opsContext({ teamOnly: false });
  const [{ data: row }, { data: updates }] = await Promise.all([getItem(supabase, id), getItemUpdates(supabase, id)]);
  if (!row) notFound();
  const item = toItem(row);
  const today = sastDate();
  const isMaint = item.area === "maintenance";
  const ms = isMaint ? maintStatus(item.status) : null;
  const urgency = urgencyLabel(item.urgency);

  return (
    <div className="ffsa-screen">
      <Masthead context={`Operations · ${areaLabel(item.area)}`} title={item.title} />

      <div className="grid md:grid-cols-[1fr_380px]">
        <div className="border-b border-rule md:border-b-0 md:border-r">
          <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3 px-5 py-5 text-[14px] md:px-8">
            <dt className="mono-label pt-0.5">Status</dt>
            <dd><StatusPill tone={STATUS_TONE[item.status]}>{ms ? MAINT_LABEL[ms] : STATUS_LABEL[item.status]}</StatusPill></dd>
            {urgency && (<><dt className="mono-label pt-0.5">Urgency</dt><dd className={item.urgency === "urgent" ? "font-semibold text-ink" : "text-ink"}>{urgency}</dd></>)}
            {item.location && (<><dt className="mono-label pt-0.5">Where</dt><dd className="text-ink">{item.location}</dd></>)}
            <dt className="mono-label pt-0.5">Given to</dt>
            <dd className="text-ink">{item.owner_name ?? "Nobody yet"}</dd>
            {item.due_on && (<><dt className="mono-label pt-0.5">By</dt><dd className="text-ink">{dayLabel(item.due_on)}{!item.closed_at && ` · ${dueWords(item.due_on, today)}`}</dd></>)}
            {item.requested_by_name && (<><dt className="mono-label pt-0.5">Asked by</dt><dd className="text-ink">{item.requested_by_name}</dd></>)}
            <dt className="mono-label pt-0.5">Came in</dt>
            <dd className="text-ink">{dayLabel(sastDate(item.created_at))} {time(item.created_at)}{item.out_of_hours && " · out of hours"}</dd>
            {!!item.photo_count && (<><dt className="mono-label pt-0.5">Photos</dt><dd className="text-ink">{item.photo_count} in the Slack thread</dd></>)}
          </dl>
          {item.details && item.details !== item.title && (
            <p className="whitespace-pre-wrap border-t border-rule px-5 py-5 text-[15px] leading-relaxed text-ink md:px-8">{item.details}</p>
          )}
          {isMaint && (
            <div className="border-t border-rule px-5 py-4 md:px-8">
              <CopyButton text={whatsappText(item)} label="Copy for WhatsApp" />
            </div>
          )}

          <SectionBar title="What's happened" meta={`${(updates ?? []).length}`} />
          <ol className="divide-y divide-rule">
            {((updates ?? []) as unknown as UpdateRow[]).map((u) => (
              <li key={u.id} className="px-5 py-3 md:px-8">
                <div className="text-[14px] text-ink">
                  <span className="font-semibold">{u.author?.display_name ?? u.author_name ?? "Someone"}</span> {describe(u)}
                  {u.via === "slack" && u.kind !== "created" && <span className="text-[color:var(--text-tertiary)]"> in Slack</span>}
                </div>
                {u.note && <p className="mt-1 whitespace-pre-wrap border-l-2 border-yellow pl-3 text-[14px] text-[color:var(--text-secondary)]">{u.note}</p>}
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">
                  {dayLabel(sastDate(u.created_at))} · {time(u.created_at)}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="px-5 py-5 md:px-6">
          <div className="mono-label mb-4">Update</div>
          <ItemUpdateForm
            itemId={item.id}
            status={item.status}
            ownerUserId={item.owner_user_id}
            dueOn={item.due_on}
            people={people}
            canAssign={isTeam}
            area={item.area}
          />
          {item.requested_by_slack_id && (
            <p className="mt-4 text-[13px] text-[color:var(--text-tertiary)]">
              {item.requested_by_name ?? "The person who asked"} gets a Slack message when this {isMaint ? "is being worked on or is finished" : "is seen, needs more time, or is done"}.
            </p>
          )}
          {isTeam && (
            <Link href={`/operations?area=${item.area}`} className="mt-6 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink underline">
              ← All {areaLabel(item.area)}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
