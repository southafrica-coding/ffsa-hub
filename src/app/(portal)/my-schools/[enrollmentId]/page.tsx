import { createClient } from "@/lib/supabase/server";
import {
  getEnrollmentById,
  getGradesByEnrollment,
  calculateGPA,
  gradeToPoints,
} from "@/services/schools";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TranscriptButton } from "./transcript-button";

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
      <div className="space-y-4">
        <p className="text-destructive">Enrollment not found.</p>
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

  const statusColors: Record<string, "default" | "secondary" | "destructive"> =
    {
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

  return (
    <div className="space-y-6">
      {/* Program Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">{program.name}</h1>
          <p className="text-sm text-muted-foreground">
            {program.code} &middot;{" "}
            {new Date(enrollment.enrolled_at).toLocaleDateString()} &middot;{" "}
            <Badge variant={statusColors[enrollment.status] ?? "secondary"}>
              {enrollment.status}
            </Badge>
          </p>
        </div>
        <TranscriptButton
          userId={enrollment.user_id}
          programId={program.id}
        />
      </div>

      {/* GPA Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Cumulative GPA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2.5rem", letterSpacing: "0.02em", color: "var(--yellow)", lineHeight: 1 }}>
              {gpa !== null ? gpa.toFixed(2) : "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Credits Earned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2.5rem", letterSpacing: "0.02em", color: "var(--yellow)", lineHeight: 1 }}>
              {totalCreditsEarned}{" "}
              <span className="text-base font-normal text-muted-foreground">
                / {program.credit_hours || totalCreditsAttempted}
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Credits Attempted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", fontSize: "2.5rem", letterSpacing: "0.02em", color: "var(--yellow)", lineHeight: 1 }}>{totalCreditsAttempted}</p>
          </CardContent>
        </Card>
      </div>

      {/* Grades Table */}
      <div className="rounded-lg border bg-card">
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
                    <TableCell className="font-medium">{course.name}</TableCell>
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
  );
}
