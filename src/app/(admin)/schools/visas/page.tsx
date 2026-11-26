import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Chip, Kpi, KpiStrip, Masthead, MastheadAction, NeedsYou, SectionBar, StatusPill } from "@/components/ffsa";
import { getVisaAccess, isLegalFor, canFollowUp } from "@/lib/visas/access";
import { VISA_OPEN_STATUSES, VISA_STATUS_LABEL, type VisaStatus, type VisaWaitingOn } from "@/lib/visas/status";
import { WAITING_LABEL, daysUntil, formatDay, personName, statusTone } from "@/lib/visas/display";
import { getProgramNames, getVisaCases, getVisaPeopleNames } from "@/services/visas";

// Visas under Training: every case the user may see (RLS decides: legal
// sees all, scoped legal and school leaders see their schools' cases).
// Leaders follow up; legal approves. Phone first: rows, not a wide table.

const VIEWS = [
  ["open", "Open"],
  ["mine", "Waiting on me"],
  ["done", "Closed"],
] as const;
type View = (typeof VIEWS)[number][0];

/** A lodge-by date this close (or past) is flagged. */
const SOON_DAYS = 21;

type CaseRow = {
  id: string;
  user_id: string;
  status: VisaStatus;
  waiting_on: VisaWaitingOn;
  stay_from: string | null;
  stay_to: string | null;
  lodge_by: string | null;
  is_standard: boolean;
  visa_case_schools: { program_id: string }[] | null;
};

export default async function VisasPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getVisaAccess(supabase, user.id);
  if (!access.open) redirect("/schools");

  const { view: rawView } = await searchParams;
  const view: View = VIEWS.some(([k]) => k === rawView) ? (rawView as View) : "open";

  const { data } = await getVisaCases(supabase);
  const all = (data ?? []) as CaseRow[];
  const programsOf = (c: CaseRow) => (c.visa_case_schools ?? []).map((s) => s.program_id);

  // "Waiting on me": legal's cases waiting on legal, leaders' waiting on a leader.
  const waitingOnMe = (c: CaseRow) =>
    (c.waiting_on === "legal" && isLegalFor(access, programsOf(c))) ||
    (c.waiting_on === "school_leader" && canFollowUp(access, programsOf(c)));

  const open = all.filter((c) => VISA_OPEN_STATUSES.includes(c.status));
  const shown =
    view === "done" ? all.filter((c) => !VISA_OPEN_STATUSES.includes(c.status)) : view === "mine" ? open.filter(waitingOnMe) : open;

  const mine = open.filter(waitingOnMe).length;
  const forLegal = open.filter((c) => c.status === "awaiting_legal").length;
  const soon = open.filter(
    (c) => c.lodge_by && ["collecting_documents", "sent_back", "awaiting_legal", "approved"].includes(c.status) && daysUntil(c.lodge_by) <= SOON_DAYS
  ).length;

  const admin = createAdminClient();
  const [{ data: people }, { data: programs }] = await Promise.all([
    getVisaPeopleNames(admin, shown.map((c) => c.user_id)),
    getProgramNames(supabase, shown.flatMap(programsOf)),
  ]);
  const nameOf = new Map((people ?? []).map((p: { id: string }) => [p.id, p]));
  const programOf = new Map<string, string>(((programs ?? []) as Array<{ id: string; code: string }>).map((p) => [p.id, p.code]));

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Training · ${open.length} open ${open.length === 1 ? "case" : "cases"}`}
        title="Visas"
        actions={access.globalLegal ? <MastheadAction href="/schools/visas/letters">Letter templates</MastheadAction> : undefined}
      />

      {/* The page's one yellow band. */}
      {mine > 0 && (
        <NeedsYou>
          {mine === 1 ? "1 visa case is waiting on you" : `${mine} visa cases are waiting on you`}
        </NeedsYou>
      )}

      <KpiStrip>
        <Kpi label="Open cases" value={String(open.length)} tick={mine === 0} lead />
        <Kpi label="Waiting for legal" value={String(forLegal)} />
        <Kpi
          label={`Lodge within ${SOON_DAYS} days`}
          value={String(soon)}
          valueColor={soon > 0 ? "var(--amber, #8A6400)" : undefined}
        />
        <Kpi label="Closed" value={String(all.length - open.length)} />
      </KpiStrip>

      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-bone px-5 py-3 md:px-8">
        {VIEWS.map(([key, label]) => (
          <Link key={key} href={key === "open" ? "/schools/visas" : `/schools/visas?view=${key}`}>
            <Chip active={view === key}>{label}</Chip>
          </Link>
        ))}
      </div>

      <div className="px-5 py-6 md:px-8 md:py-7">
        <div className="border border-ink">
          <SectionBar title="Cases" meta={`${shown.length}`} />
          {shown.length === 0 ? (
            <p className="mono-label px-6 py-12 text-center">
              {view === "mine" ? "Nothing is waiting on you" : "No cases here"}
            </p>
          ) : (
            <ul>
              {shown.map((c) => {
                const lodgeDays = c.lodge_by ? daysUntil(c.lodge_by) : null;
                return (
                  <li key={c.id} className="border-b border-rule last:border-b-0">
                    <Link
                      href={`/schools/visas/${c.id}`}
                      className="flex min-h-[46px] flex-col gap-2 px-5 py-4 hover:bg-bone md:flex-row md:items-center md:gap-6 md:px-6"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-[16px] font-black uppercase leading-[0.95] tracking-[0.05em]">
                          {personName(nameOf.get(c.user_id) as never)}
                        </div>
                        {/* Schools and stay on separate lines: at 390px one line cut the dates off. */}
                        <div className="mono-label mt-2 truncate">
                          {programsOf(c).map((p) => programOf.get(p) ?? "School").join(" + ")}
                        </div>
                        <div className="mono-label mt-1">
                          {c.stay_from ? `${formatDay(c.stay_from)} – ${formatDay(c.stay_to)}` : "Stay not dated"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill tone={statusTone(c.status)}>{VISA_STATUS_LABEL[c.status]}</StatusPill>
                        {c.waiting_on !== "nobody" && (
                          <span className="mono-label">Waiting on {WAITING_LABEL[c.waiting_on].toLowerCase()}</span>
                        )}
                        {lodgeDays != null && VISA_OPEN_STATUSES.includes(c.status) && (
                          <span className={`mono-label ${lodgeDays <= SOON_DAYS ? "text-amber" : ""}`}>
                            Lodge by {formatDay(c.lodge_by)}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
