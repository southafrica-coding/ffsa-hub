import Link from "next/link";
import { NeedsYou, NeedsYouAction, SectionBar, StatusPill, type Tone } from "@/components/ffsa";
import { feeSetupHref } from "@/lib/schools/lms-api";

type CourseRow = {
  id: string;
  code: string;
  name: string;
  sequence: number;
  status: string;
  graded?: boolean;
  start_date: string | null;
  end_date: string | null;
};

const STATUS_TONE: Record<string, Tone> = {
  active: "good",
  upcoming: "quiet",
  completed: "quiet",
  archived: "quiet",
};

function when(course: CourseRow) {
  if (!course.start_date && !course.end_date) return "No dates";
  const start = course.start_date
    ? new Date(`${course.start_date}T00:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
    : "—";
  const end = course.end_date
    ? new Date(`${course.end_date}T00:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
    : "—";
  return `${start} – ${end}`;
}

export function ClassroomIndex({
  programId,
  courses,
  lettersOpen,
}: {
  programId: string;
  courses: CourseRow[];
  lettersOpen: number;
}) {
  const sorted = [...courses].sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));
  return (
    <div>
      {lettersOpen > 0 ? (
        <NeedsYou action={<NeedsYouAction href={`/schools/${programId}/classroom/grading`}>Open the queue</NeedsYouAction>}>
          {lettersOpen === 1
            ? "1 official letter is still open."
            : `${lettersOpen} official letters are still open.`}
        </NeedsYou>
      ) : null}

      <SectionBar title="Courses" meta={`${sorted.length}`} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3 md:px-8">
        <p className="max-w-xl text-[13px] leading-snug text-[#55524A]">
          Design the pages, assignments, and discussions for each course. Fee items stay in Finance.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/schools/${programId}/classroom/new`}
            className="inline-flex min-h-11 items-center border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
          >
            Add a course
          </Link>
          <Link
            href={`/schools/${programId}/classroom/templates`}
            className="inline-flex min-h-11 items-center border border-ink bg-white px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
          >
            Templates
          </Link>
          <Link
            href={`/schools/${programId}/classroom/grading`}
            className="inline-flex min-h-11 items-center border border-ink bg-white px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
          >
            Grading
          </Link>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="px-5 py-10 md:px-8">
          <p className="text-[14px]">This school has no courses yet.</p>
          <p className="mt-2 text-[13px] text-[#55524A]">
            Add one here for the classroom, or from the Courses tab. Either way, fees are set up in{" "}
            <Link href={feeSetupHref(programId)} className="underline">
              Finance
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul>
          {sorted.map((course) => (
            <li key={course.id} className="flex flex-col gap-3 border-b border-rule px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[18px] font-black uppercase leading-none">{course.name}</span>
                  <StatusPill tone={STATUS_TONE[course.status] ?? "quiet"}>{course.status.replace(/_/g, " ")}</StatusPill>
                  {course.graded === true ? null : <StatusPill>Not graded</StatusPill>}
                </div>
                <p className="mono-label mt-1.5">
                  {course.code} · {when(course)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/schools/${programId}/classroom/${course.id}`}
                  className="inline-flex min-h-11 items-center border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
                >
                  Design
                </Link>
                <Link
                  href={feeSetupHref(programId, course.id)}
                  className="inline-flex min-h-11 items-center border border-ink bg-white px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
                >
                  Fees
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
