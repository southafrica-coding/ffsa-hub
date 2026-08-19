import { createClient } from "@/lib/supabase/server";
import { getEnrollmentsByUser, getResponsesByUser } from "@/services/schools";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, FileText, UserCircle2, ClipboardList } from "lucide-react";
import Link from "next/link";
import { Masthead } from "@/components/ffsa";

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

function PointOfContact({ staff, label }: { staff: AssignedStaff; label: string }) {
  const name = staffLabel(staff);
  if (!name) return null;
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs">
      <UserCircle2 className="mt-0.5 h-3.5 w-3.5 text-primary shrink-0" />
      <div className="leading-tight">
        <p className="font-medium text-primary uppercase tracking-wider" style={{ fontSize: "9px", letterSpacing: "0.15em" }}>
          {label}
        </p>
        <p className="text-foreground">{name}</p>
        {staff?.email && (
          <a
            href={`mailto:${staff.email}`}
            className="text-muted-foreground hover:underline"
          >
            {staff.email}
          </a>
        )}
      </div>
    </div>
  );
}

export default async function MySchoolsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p>Not authenticated.</p>;
  }

  const userId = user.id;
  const { data: enrollments } = await getEnrollmentsByUser(supabase, userId);
  const { data: myResponses } = await getResponsesByUser(supabase, userId);

  // Get programs with open applications
  const { data: openPrograms } = await supabase
    .from("programs")
    .select("id, name, code, credit_hours")
    .eq("application_open", true)
    .eq("status", "active")
    .order("name", { ascending: true });

  // Build a set of program IDs the user already applied to
  const appliedProgramIds = new Set(
    (myResponses ?? []).map((r: { program_id: string }) => r.program_id)
  );

  // Build a map of programId -> response status
  const responseStatusMap = new Map<string, string>();
  const responseStaffMap = new Map<string, AssignedStaff>();
  for (const r of myResponses ?? []) {
    const row = r as {
      program_id: string;
      status: string;
      assigned_staff: AssignedStaff;
    };
    responseStatusMap.set(row.program_id, row.status);
    responseStaffMap.set(row.program_id, row.assigned_staff ?? null);
  }

  const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
    waiting_for_arrival: "secondary",
    arrived: "default",
    graduated: "secondary",
    dismissed: "destructive",
    decided_to_leave: "secondary",
    // legacy fallbacks
    active: "default",
    completed: "secondary",
    withdrawn: "destructive",
    on_hold: "secondary",
  };

  const appStatusColors: Record<string, "default" | "secondary" | "destructive"> = {
    submitted: "secondary",
    waiting_for_references: "secondary",
    references_received: "secondary",
    interview_scheduled: "secondary",
    accepted: "default",
    rejected: "destructive",
    waitlisted: "secondary",
    cancelled: "secondary",
  };

  // Friendly, human-readable labels for the raw DB application statuses.
  const appStatusLabels: Record<string, string> = {
    submitted: "Submitted",
    waiting_for_references: "Awaiting references",
    references_received: "References received",
    interview_scheduled: "Interview scheduled",
    accepted: "Accepted",
    rejected: "Not accepted",
    waitlisted: "Waitlisted",
    cancelled: "Cancelled",
  };
  const appStatusLabel = (s: string) =>
    appStatusLabels[s] ?? s.replace(/_/g, " ");

  return (
    <div className="ffsa-screen">
      <Masthead context="Training & education" title="My Training" />
      <div className="space-y-6 px-5 py-6 md:px-8">
        {/* Open Applications Section */}
        {openPrograms && openPrograms.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Open Applications
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {openPrograms.map((program: {
                id: string;
                name: string;
                code: string;
                credit_hours: number;
              }) => {
                const applied = appliedProgramIds.has(program.id);
                const appStatus = responseStatusMap.get(program.id);

                return (
                  <Card key={program.id} className="hover:border-primary/50 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{program.name}</CardTitle>
                        {applied && appStatus && (
                          <Badge variant={appStatusColors[appStatus] ?? "secondary"}>
                            {appStatusLabel(appStatus)}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-mono text-muted-foreground">
                        {program.code}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {program.credit_hours} credit hours
                        </span>
                        {applied ? (
                          <span className="text-sm text-muted-foreground">
                            Application submitted
                          </span>
                        ) : (
                          <Link
                            href={`/my-schools/apply/${program.id}`}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            Apply Now &rarr;
                          </Link>
                        )}
                      </div>
                      {applied && (
                        <PointOfContact
                          staff={responseStaffMap.get(program.id) ?? null}
                          label="Your application contact"
                        />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* My Applications Section */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            My Applications
          </h2>

          {!myResponses || myResponses.length === 0 ? (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground text-center">
                  You haven&apos;t submitted any applications yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {(myResponses as Array<{
                id: string;
                status: string;
                submitted_at: string | null;
                assigned_staff: AssignedStaff;
                programs: { id: string; name: string; code: string } | null;
              }>).map((response) => (
                <Card key={response.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">
                        {response.programs?.name ?? "Program"}
                      </CardTitle>
                      <Badge variant={appStatusColors[response.status] ?? "secondary"}>
                        {appStatusLabel(response.status)}
                      </Badge>
                    </div>
                    {response.programs?.code && (
                      <p className="text-sm font-mono text-muted-foreground">
                        {response.programs.code}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    {response.submitted_at && (
                      <p className="text-sm text-muted-foreground">
                        Submitted:{" "}
                        {new Date(response.submitted_at).toLocaleDateString()}
                      </p>
                    )}
                    <PointOfContact
                      staff={response.assigned_staff}
                      label="Your application contact"
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Enrollments Section */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            My Enrollments
          </h2>

          {!enrollments || enrollments.length === 0 ? (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground text-center">
                  You are not currently enrolled in any programs.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {enrollments.map((enrollment: {
                id: string;
                status: string;
                enrolled_at: string;
                completed_at: string | null;
                assigned_staff: AssignedStaff;
                programs: {
                  id: string;
                  name: string;
                  code: string;
                  credit_hours: number;
                };
              }) => (
                <Link key={enrollment.id} href={`/my-schools/${enrollment.id}`}>
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          {enrollment.programs.name}
                        </CardTitle>
                        <Badge variant={statusColors[enrollment.status] ?? "secondary"}>
                          {enrollment.status}
                        </Badge>
                      </div>
                      <p className="text-sm font-mono text-muted-foreground">
                        {enrollment.programs.code}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>
                          Enrolled:{" "}
                          {new Date(enrollment.enrolled_at).toLocaleDateString()}
                        </span>
                        <span>
                          {enrollment.programs.credit_hours} credit hours
                        </span>
                      </div>
                      <PointOfContact
                        staff={enrollment.assigned_staff}
                        label="Your program contact"
                      />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
