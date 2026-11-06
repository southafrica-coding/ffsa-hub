"use client";

import { useEffect, useState } from "react";
import { designFromUnknown, lmsCall, lmsMessage, type CourseDesign } from "@/lib/schools/lms-api";
import { StudentCourseBody, type StudentCourseShape } from "./student-course-view";

const STUDENT_GAP =
  "Your school keeps the pages and assignments on the course. Students cannot read that saved design through the hub yet — the outline call is for school leaders. Your official letter is on this page either way.";

export function StudentOutline({
  programId,
  courseId,
  course,
}: {
  programId: string;
  courseId: string;
  course: StudentCourseShape;
}) {
  const [design, setDesign] = useState<CourseDesign | null>(null);
  const [note, setNote] = useState<string | null>("Loading the classroom…");

  useEffect(() => {
    let cancelled = false;
    lmsCall<{ outline: { design?: unknown } | null }>(
      `/api/schools/programs/${programId}/learning-courses/${courseId}/outline`
    )
      .then((body) => {
        if (cancelled) return;
        const next = designFromUnknown(body.outline?.design);
        setDesign(next);
        setNote(
          next
            ? null
            : body.outline
              ? "The saved classroom could not be read."
              : "This course has no classroom yet. Your school leader adds pages and assignments from Training."
        );
      })
      .catch((error) => {
        if (cancelled) return;
        const failure = lmsMessage(error);
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        setDesign(null);
        if (code === "forbidden") setNote(STUDENT_GAP);
        else if (code === "lms_schema_not_applied") setNote(failure);
        else if (code === "not_deployed") setNote(failure);
        else setNote(failure);
      });
    return () => {
      cancelled = true;
    };
  }, [programId, courseId]);

  return <StudentCourseBody course={course} design={design} note={note} />;
}
