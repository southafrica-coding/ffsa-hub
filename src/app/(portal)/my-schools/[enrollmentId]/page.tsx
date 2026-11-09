import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  getEnrollmentById,
  getGradesByEnrollment,
  calculateGPA,
  gradeToPoints,
} from "@/services/schools";
import { Badge } from "@/components/ui/badge";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TranscriptButton } from "./transcript-button";
import { Masthead, KpiStrip, Kpi, StatusPill, type Tone } from "@/components/ffsa";

const ENROLLMENT_TONE: Record<string, Tone> = {
  arrived: "good",
  active: "good",
  waiting_for_arrival: "warn",
  on_hold: "warn",
  graduated: "quiet",
  completed: "quiet",
  decided_to_leave: "quiet",
  dismissed: "bad",
  withdrawn: "bad",
};

export default async function EnrollmentDetailPage({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  const { enrollmentId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p>Not authenticated.</p>;
  }

  const { data: enrollment, error } = await getEnrollmentById(
    supabase,
    enrollmentId
  );

  if (error || !enrollment) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Training" title="Not found" />
        <p className="px-5 py-8 text-sm text-destructive md:px-8">
          That enrolment could not be found.
        </p>
      </div>
    );
  }

  const { data: gradesData } = await getGradesByEnrollment(
    supabase,
    enrollmentId
  );

  const program = enrollment.programs;
  const courses = program.courses ?? [];
  const grades = gradesData ?? [];

  // Build grade map: courseId -> letterGrade
  const gradeMap = new Map<string, string>();
  for (const g of grades) {
    if (g.letter_grade) {
      gradeMap.set(g.course_id, g.letter_grade);
    }
  }

  // Build course list with grades
  const courseList = courses.map(
    (c: { id: string; code: string; name: string; credit_hours: number }) => {
      const letterGrade = gradeMap.get(c.id) ?? null;
      const points = letterGrade ? gradeToPoints(letterGrade) : null;
      return {
        ...c,
        letterGrade,
        qualityPoints:
          points !== null
            ? Math.round(points * c.credit_hours * 100) / 100
            : null,
      };
    }
  );

  // Calculate GPA
  const gradedCourses = courseList
    .filter(
      (c: { letterGrade: string | null }) => c.letterGrade !== null
    )
    .map((c: { letterGrade: string | null; credit_hours: number }) => ({
      letter_grade: c.letterGrade,
      credit_hours: c.credit_hours,
    }));

  const gpa = calculateGPA(gradedCourses);

  const totalCreditsAttempted = gradedCourses.reduce(
    (sum: number, c: { credit_hours: number }) => sum + c.credit_hours,
    0
  );

  const totalCreditsEarned = courseList
    .filter(
      (c: { letterGrade: string | null }) =>
        c.letterGrade &&
        c.letterGrade !== "F" &&
        c.letterGrade !== "W" &&
        c.letterGrade !== "I"
    )
    .reduce(
      (sum: number, c: { credit_hours: number }) => sum + c.credit_hours,
      0
    );


  return (
    <div className="ffsa-screen">
      <Masthead
        context={`${program.code} · enrolled ${new Date(enrollment.enrolled_at).toLocaleDateString("en-ZA")}`}
        title={program.name}
        actions={
          <>
            <StatusPill tone={ENROLLMENT_TONE[enrollment.status] ?? "quiet"}>
              {enrollment.status.replace(/_/g, " ")}
            </StatusPill>
            <TranscriptButton
              userId={enrollment.user_id}
              programId={program.id}
            />
          </>
        }
      />

      {/* Frame 4d's rule: one big numeral per screen, and yellow is reserved
          for the single NeedsYou band. These three were 2.5rem yellow
          condensed — now the system's KPI strip, black, with the lead cell
          carrying the only accent tick. */}
      <KpiStrip>
        {/* An em dash at the strip's 54px reads as a redaction bar, not as
            "nothing yet" — so an ungraded GPA drops to a quiet mono note. */}
        <Kpi
          label="Cumulative GPA"
          value={gpa !== null ? gpa.toFixed(2) : "Not graded yet"}
          size={gpa !== null ? 54 : 15}
          valueColor={gpa !== null ? undefined : "var(--text-tertiary)"}
          lead
          tick={gpa !== null}
        />
        <Kpi
          label="Credits earned"
          value={String(totalCreditsEarned)}
          foot={`of ${program.credit_hours || totalCreditsAttempted}`}
        />
        <Kpi label="Credits attempted" value={String(totalCreditsAttempted)} />
      </KpiStrip>

      {/* Grades Table */}
      <div className="px-5 py-6 md:px-8 md:py-7">
      <div className="border border-ink bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Course</TableHead>
              <TableHead className="text-center">Credits</TableHead>
              <TableHead className="text-center">Grade</TableHead>
              <TableHead className="text-center">Quality Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {courseList.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  No courses in this program yet.
                </TableCell>
              </TableRow>
            ) : (
              courseList.map(
                (course: {
                  id: string;
                  code: string;
                  name: string;
                  credit_hours: number;
                  letterGrade: string | null;
                  qualityPoints: number | null;
                }) => (
                  <TableRow key={course.id}>
                    <TableCell className="font-mono text-sm">
                      {course.code}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/my-schools/${enrollmentId}/courses/${course.id}`}
                        className="underline decoration-[#DEDACE] underline-offset-2"
                      >
                        {course.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-center">
                      {course.credit_hours}
                    </TableCell>
                    <TableCell className="text-center">
                      {course.letterGrade ? (
                        <Badge variant="secondary">{course.letterGrade}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {course.qualityPoints !== null
                        ? course.qualityPoints.toFixed(2)
                        : "—"}
                    </TableCell>
                  </TableRow>
                )
              )
            )}
          </TableBody>
        </Table>
      </div>
      </div>
    </div>
  );
}
