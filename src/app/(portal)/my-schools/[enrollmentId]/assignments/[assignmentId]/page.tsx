import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Masthead } from "@/components/ffsa";
import { isClassroomEnrollment } from "@/lib/schools/lms-content";
import { AssignmentView } from "./assignment-view";

// Student assignment page (LMS slice 2). The page only checks that this is
// the signed-in student's own active enrolment; the view loads everything
// through /api/my-schools/[enrollmentId]/lms/assignments/[assignmentId].

export default async function StudentAssignmentPage({
  params,
}: {
  params: Promise<{ enrollmentId: string; assignmentId: string }>;
}) {
  const { enrollmentId, assignmentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p>Not authenticated.</p>;

  const { data } = await supabase
    .from("enrollments")
    .select("id, user_id, status, removed_at")
    .eq("id", enrollmentId)
    .maybeSingle();
  const row = data as { user_id: string; status: string; removed_at: string | null } | null;
  if (!row || row.user_id !== user.id || !isClassroomEnrollment(row)) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Training" title="Not found" />
        <p className="px-5 py-8 text-sm text-destructive md:px-8">That assignment could not be found.</p>
      </div>
    );
  }

  return (
    <div className="ffsa-screen">
      <Masthead context="Training · Assignment" title="Assignment" />
      <div className="px-5 pt-4 md:px-8">
        <Link href={`/my-schools/${enrollmentId}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">
          ← Back to my school
        </Link>
      </div>
      <AssignmentView enrollmentId={enrollmentId} assignmentId={assignmentId} />
    </div>
  );
}
