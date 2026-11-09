import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseStaffDecisions } from "@/lib/auth/check-okr-access";
import {
  listLeadershipTrackPrograms,
  loadStaffDecisionRows,
} from "@/lib/schools/staff-decisions";
import { Masthead } from "@/components/ffsa";

// Leadership Team's way in to the Leadership Track "accepted as staff?" tab
// (migration 247). Lists every Leadership Track school — ended and archived
// ones included, since this access never expires — read with the
// service-role client after the Leadership Team check.
export default async function StaffDecisionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await canUseStaffDecisions(supabase, user.id))) redirect("/dashboard");

  const admin = createAdminClient();
  const programs = await listLeadershipTrackPrograms(admin);
  const schools = await Promise.all(
    programs.map(async (p) => {
      const rows = await loadStaffDecisionRows(admin, p.id);
      const yes = rows.filter((r) => r.decision?.accepted === true).length;
      const no = rows.filter((r) => r.decision?.accepted === false).length;
      return { ...p, total: rows.length, yes, no, undecided: rows.length - yes - no };
    })
  );
  schools.sort((a, b) => b.name.localeCompare(a.name));

  return (
    <div className="ffsa-screen">
      <Masthead context="Leadership Track" title="Staff decisions" />
      <div className="space-y-4 px-5 py-6 md:px-8 md:py-7">
        <p className="max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          Decide which Leadership Track students are accepted onto staff. Only the
          Leadership Team can see this, and it stays available after a school ends.
        </p>
        {schools.length === 0 ? (
          <p className="border border-rule px-4 py-6 text-[13px] text-[color:var(--text-secondary)]">
            No Leadership Track schools yet.
          </p>
        ) : (
          <div className="overflow-x-auto border border-rule">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink bg-bone">
                <tr className="font-mono text-[10px] uppercase tracking-[0.14em]">
                  <th className="px-3 py-2">School</th>
                  <th className="px-3 py-2 text-right">Students</th>
                  <th className="px-3 py-2 text-right">Yes</th>
                  <th className="px-3 py-2 text-right">No</th>
                  <th className="px-3 py-2 text-right">Undecided</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id} className="border-b border-rule last:border-0">
                    <td className="px-3 py-3">
                      <Link
                        href={`/schools/${s.id}?tab=staff_decision`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {s.name}
                      </Link>
                      {s.status === "archived" && (
                        <span className="ml-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{s.total}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{s.yes}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{s.no}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{s.undecided}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
