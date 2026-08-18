import { createClient } from "@/lib/supabase/server";
import { getEnrollmentsByUser, getResponsesByUser } from "@/services/schools";
import Link from "next/link";
import {
  Masthead,
  NeedsYou,
  NeedsYouAction,
  SectionBar,
  StatusPill,
  type Tone,
} from "@/components/ffsa";

type AssignedStaff = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
} | null;

function staffLabel(s: AssignedStaff) {
  if (!s) return null;
  const f = s.preferred_name || s.first_name || "";
  const l = s.last_name || "";
  const n = `${f} ${l}`.trim();
  return n || s.email;
}

/**
 * The person walking with you. In the old composition this was a tinted
 * rounded box under every card; here it is the row's second line, because
 * frame 4d's rule is that a row never runs to three.
 */
function contactLine(staff: AssignedStaff): string | null {
  const name = staffLabel(staff);
  return name ? `Walking with ${name}` : null;
}

const ENROLLMENT_TONE: Record<string, Tone> = {
  arrived: "good",
  active: "good",
  waiting_for_arrival: "warn",
  graduated: "quiet",
  completed: "quiet",
  decided_to_leave: "quiet",
  on_hold: "warn",
  dismissed: "bad",
  withdrawn: "bad",
};

const APP_TONE: Record<string, Tone> = {
  accepted: "good",
  submitted: "warn",
  waiting_for_references: "warn",
  references_received: "warn",
  interview_scheduled: "warn",
  waitlisted: "quiet",
  cancelled: "quiet",
  rejected: "bad",
};

const APP_STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  waiting_for_references: "Awaiting references",
  references_received: "References received",
  interview_scheduled: "Interview scheduled",
  accepted: "Accepted",
  rejected: "Not accepted",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
};
const appStatusLabel = (s: string) => APP_STATUS_LABELS[s] ?? s.replace(/_/g, " ");

type ResponseRow = {
  id: string;
  program_id: string;
  status: string;
  submitted_at: string | null;
  assigned_staff: AssignedStaff;
  programs: { id: string; name: string; code: string } | null;
};

type EnrollmentRow = {
  id: string;
  status: string;
  enrolled_at: string;
  completed_at: string | null;
  assigned_staff: AssignedStaff;
  programs: { id: string; name: string; code: string; credit_hours: number };
};

export default async function MySchoolsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Training & education" title="My training" />
        <p className="px-5 py-8 text-sm md:px-8">Not authenticated.</p>
      </div>
    );
  }

  const userId = user.id;
  const { data: enrollments } = await getEnrollmentsByUser(supabase, userId);
  const { data: myResponses } = await getResponsesByUser(supabase, userId);

  const { data: openPrograms } = await supabase
    .from("programs")
    .select("id, name, code, credit_hours")
    .eq("application_open", true)
    .eq("status", "active")
    .order("name", { ascending: true });

  const responses = (myResponses ?? []) as ResponseRow[];
  const enrolled = (enrollments ?? []) as EnrollmentRow[];
  const programs = (openPrograms ?? []) as Array<{
    id: string;
    name: string;
    code: string;
    credit_hours: number;
  }>;

  const appliedProgramIds = new Set(responses.map((r) => r.program_id));
  const notYetApplied = programs.filter((p) => !appliedProgramIds.has(p.id));

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Training & education · ${enrolled.length} ${enrolled.length === 1 ? "enrolment" : "enrolments"}`}
        title="My training"
      />

      {/* The page's ONE yellow band: something is open that you have not
          applied to. Nothing else on this screen is yellow. */}
      {notYetApplied.length > 0 && (
        <NeedsYou
          action={
            notYetApplied.length === 1 ? (
              <NeedsYouAction href={`/my-schools/apply/${notYetApplied[0].id}`}>
                Apply
              </NeedsYouAction>
            ) : undefined
          }
        >
          {notYetApplied.length === 1
            ? `Applications are open for ${notYetApplied[0].name}`
            : `${notYetApplied.length} schools are open for applications`}
        </NeedsYou>
      )}

      {/* Open applications */}
      {programs.length > 0 && (
        <section>
          <SectionBar title="Open for applications" meta={`${programs.length}`} />
          <ul>
            {programs.map((program) => {
              const applied = appliedProgramIds.has(program.id);
              const status = responses.find(
                (r) => r.program_id === program.id
              )?.status;
              return (
                <li
                  key={program.id}
                  className="flex min-h-[48px] items-center justify-between gap-4 border-b border-rule px-5 py-3.5 md:px-8"
                >
                  <div className="min-w-0">
                    <div className="truncate font-display text-[17px] font-black uppercase leading-none text-ink">
                      {program.name}
                    </div>
                    <div className="mono-label mt-1.5 truncate">
                      {program.code} · {program.credit_hours} credit hours
                    </div>
                  </div>
                  {applied && status ? (
                    <StatusPill tone={APP_TONE[status] ?? "quiet"}>
                      {appStatusLabel(status)}
                    </StatusPill>
                  ) : (
                    <Link
                      href={`/my-schools/apply/${program.id}`}
                      className="shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622] hover:text-white"
                    >
                      Apply
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* My applications */}
      <section>
        <SectionBar title="My applications" meta={`${responses.length}`} />
        {responses.length === 0 ? (
          <div className="border-b border-rule px-5 py-10 text-center md:px-8">
            <p className="mono-label">You haven&apos;t applied to anything yet</p>
          </div>
        ) : (
          <ul>
            {responses.map((response) => {
              const contact = contactLine(response.assigned_staff);
              const submitted = response.submitted_at
                ? `Submitted ${new Date(response.submitted_at).toLocaleDateString("en-ZA")}`
                : null;
              return (
                <li
                  key={response.id}
                  className="flex min-h-[48px] items-center justify-between gap-4 border-b border-rule px-5 py-3.5 md:px-8"
                >
                  <div className="min-w-0">
                    <div className="truncate font-display text-[17px] font-black uppercase leading-none text-ink">
                      {response.programs?.name ?? "Programme"}
                    </div>
                    {/* One second line: who is walking with you if anyone,
                        otherwise when you sent it. */}
                    <div className="mono-label mt-1.5 truncate">
                      {contact ?? submitted ?? response.programs?.code ?? "—"}
                    </div>
                  </div>
                  <StatusPill tone={APP_TONE[response.status] ?? "quiet"}>
                    {appStatusLabel(response.status)}
                  </StatusPill>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Enrolments */}
      <section>
        <SectionBar title="My enrolments" meta={`${enrolled.length}`} />
        {enrolled.length === 0 ? (
          <div className="border-b border-rule px-5 py-10 text-center md:px-8">
            <p className="mono-label">You are not enrolled in a school yet</p>
          </div>
        ) : (
          <ul>
            {enrolled.map((enrollment) => {
              const contact = contactLine(enrollment.assigned_staff);
              return (
                <li key={enrollment.id} className="border-b border-rule">
                  <Link
                    href={`/my-schools/${enrollment.id}`}
                    className="flex min-h-[48px] items-center justify-between gap-4 px-5 py-3.5 hover:bg-[#F7F5EE] md:px-8"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-display text-[17px] font-black uppercase leading-none text-ink">
                        {enrollment.programs.name}
                      </div>
                      <div className="mono-label mt-1.5 truncate">
                        {contact ??
                          `Enrolled ${new Date(enrollment.enrolled_at).toLocaleDateString("en-ZA")}`}
                      </div>
                    </div>
                    <StatusPill tone={ENROLLMENT_TONE[enrollment.status] ?? "quiet"}>
                      {enrollment.status.replace(/_/g, " ")}
                    </StatusPill>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
