import { createClient } from "@/lib/supabase/server";
import { getMyOutreachTeams } from "@/services/outreach-finance";
import { getMyStudentFees } from "@/services/school-fees";
import Link from "next/link";
import {
  Masthead,
  NeedsYou,
  NeedsYouAction,
  SectionBar,
  StatusPill,
  Bar,
  type Tone,
} from "@/components/ffsa";
import { SchoolFeesCard } from "./school-fees-card";

// Frame 4d — one big numeral per screen. On this screen the numeral is what
// the student still owes, because that is the only figure they open the page
// to find. Everything else is a two-line row.

type StudentFee = {
  id: string;
  tier: string;
  tuition_zar: number;
  accommodation_zar: number;
  meals_zar: number;
  materials_zar: number;
  total_due_zar: number;
  discount_zar: number;
  scholarship_zar: number;
  final_amount_zar: number;
  amount_paid_zar: number;
  status: string;
  programs: { id: string; name: string; code: string };
  student_payments: {
    id: string;
    payment_date: string;
    amount_zar: number;
    payment_method: string;
    reference: string | null;
  }[];
};

type TeamMembership = {
  id: string;
  role: string;
  outreach_teams: {
    id: string;
    team_name: string;
    location: string | null;
    status: string;
    people_count: number;
    programs: { name: string; code: string };
  };
};

const TEAM_TONE: Record<string, Tone> = {
  active: "good",
  planning: "warn",
  review: "warn",
  closed: "quiet",
};

/** R 38 800 — grouped with a thin space, never a comma. */
function rands(amount: number): string {
  return `R ${Math.round(amount).toLocaleString("en-ZA").replace(/,/g, " ")}`;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export default async function MyFinancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Personal" title="My finance" />
        <p className="px-5 py-8 text-sm md:px-8">Not authenticated.</p>
      </div>
    );
  }

  const [{ data: teamMemberships }, { data: studentFees }] = await Promise.all([
    getMyOutreachTeams(supabase, user.id),
    getMyStudentFees(supabase, user.id),
  ]);

  const fees = (studentFees ?? []) as StudentFee[];
  const teams = (teamMemberships ?? []) as TeamMembership[];

  // The screen's one figure. Summed across every enrolment, because a
  // student with two schools owes one amount, not two.
  const totalDue = fees.reduce((s, f) => s + (f.final_amount_zar ?? 0), 0);
  const totalPaid = fees.reduce((s, f) => s + (f.amount_paid_zar ?? 0), 0);
  const outstanding = Math.max(0, totalDue - totalPaid);
  const paidPct = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : null;

  return (
    <div className="ffsa-screen">
      <Masthead context="Personal" title="My finance" />

      {/* The page's ONE yellow band. */}
      {outstanding > 0 && (
        <NeedsYou
          action={
            fees.length === 1 ? (
              <NeedsYouAction href={`/my-schools`}>View school</NeedsYouAction>
            ) : undefined
          }
        >
          {rands(outstanding)} outstanding on your school fees
        </NeedsYou>
      )}

      {/* One big numeral. Only drawn when there are fees to have a figure. */}
      {fees.length > 0 && (
        <div className="border-b border-ink px-5 py-6 md:px-8 md:py-7">
          <div className="mono-label mb-3">
            {outstanding > 0 ? "Still to pay" : "Fees settled"}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="numeral text-[52px] leading-none md:text-[64px]">
              {rands(outstanding > 0 ? outstanding : totalPaid)}
            </span>
            {outstanding > 0 && (
              <span className="font-mono text-[13px] text-[color:var(--text-tertiary)]">
                of {rands(totalDue)}
              </span>
            )}
          </div>
          {paidPct !== null && (
            <div className="mt-4 max-w-md">
              <Bar pct={paidPct} tone={outstanding > 0 ? "#0A0A0A" : "#3E7F2B"} />
              <div className="mono-label mt-2.5">
                {paidPct}% paid · {rands(totalPaid)} received
              </div>
            </div>
          )}
        </div>
      )}

      {/* School fees, one card per enrolment. */}
      {fees.length > 0 && (
        <section>
          <SectionBar
            title="School fees"
            meta={`${fees.length} ${fees.length === 1 ? "enrolment" : "enrolments"}`}
          />
          <div className="grid gap-px bg-rule md:grid-cols-2">
            {fees.map((fee) => (
              <div key={fee.id} className="bg-white">
                <SchoolFeesCard fee={fee} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Outreach teams — two-line rows, never three. */}
      {teams.length > 0 && (
        <section>
          <SectionBar
            title="Outreach teams"
            meta={`${teams.length} ${teams.length === 1 ? "team" : "teams"}`}
          />
          <ul>
            {teams.map((m) => {
              const team = m.outreach_teams;
              return (
                <li key={m.id} className="border-b border-rule">
                  <Link
                    href={`/my-finance/outreach/${team.id}`}
                    className="flex min-h-[48px] items-center justify-between gap-4 px-5 py-3.5 hover:bg-[#F7F5EE] md:px-8"
                  >
                    <div className="min-w-0">
                      {/* Line one: what it is. */}
                      <div className="truncate font-display text-[17px] font-black uppercase leading-none text-ink">
                        {team.team_name}
                      </div>
                      {/* Line two: everything else, on ONE line. */}
                      <div className="mono-label mt-1.5 truncate">
                        {team.programs?.name ?? "Programme TBC"} ·{" "}
                        {team.location ?? "Location TBC"} · {titleCase(m.role)}
                      </div>
                    </div>
                    <StatusPill tone={TEAM_TONE[team.status] ?? "quiet"}>
                      {team.status}
                    </StatusPill>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {fees.length === 0 && teams.length === 0 && (
        <div className="px-5 py-12 text-center md:px-8">
          <p className="mono-label">
            Nothing to pay and no outreach team yet — this page fills up when
            you enrol or join a team
          </p>
        </div>
      )}
    </div>
  );
}
