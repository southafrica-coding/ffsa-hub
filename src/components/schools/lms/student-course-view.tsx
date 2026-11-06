import { Kpi, KpiStrip, SectionBar, StatusPill } from "@/components/ffsa";
import { dueOn, summaryLine, summarizeDesign, type CourseDesign } from "@/lib/schools/lms-api";

export type StudentCourseShape = {
  code: string;
  name: string;
  startDate: string | null;
  graded: boolean;
};

function kindLabel(kind: string) {
  if (kind === "page") return "Page";
  if (kind === "assignment") return "Assignment";
  return "Discussion";
}

export function StudentCourseBody({
  course,
  design,
  note,
}: {
  course: StudentCourseShape;
  design: CourseDesign | null;
  note?: string | null;
}) {
  return (
    <section>
      <SectionBar
        title="Classroom"
        meta={design ? summaryLine(summarizeDesign(design)) : undefined}
      />
      {note ? (
        <p className="border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-ink md:px-8">{note}</p>
      ) : null}
      {design?.summary ? (
        <p className="border-b border-rule px-5 py-4 text-[14px] leading-relaxed md:px-8">{design.summary}</p>
      ) : null}
      {design && design.modules.length > 0 ? (
        <div>
          <p className="border-b border-rule px-5 py-3 text-[13px] text-[#55524A] md:px-8">
            Handing work in is not open yet. Your school will say when it is.
          </p>
          {design.modules.map((section, index) => (
            <div key={`${section.title}-${index}`} id={`module-${index + 1}`}>
              <div className="border-b border-ink bg-bone px-5 py-3 md:px-8">
                <div className="mono-label">Module {index + 1}</div>
                <h2 className="mt-1 font-display text-[22px] font-black uppercase leading-none">{section.title}</h2>
                {section.summary ? <p className="mt-2 text-[13px] text-[#55524A]">{section.summary}</p> : null}
              </div>
              {section.items.length === 0 ? (
                <p className="border-b border-rule px-5 py-4 text-[13px] text-[#55524A] md:px-8">Nothing in this module yet.</p>
              ) : (
                <ul>
                  {section.items.map((item, itemIndex) => (
                    <li key={`${item.title}-${itemIndex}`} className="border-b border-rule px-5 py-4 md:px-8">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill>{kindLabel(item.kind)}</StatusPill>
                        {item.kind === "assignment" ? (
                          <span className="mono-label">
                            {item.points} {item.points === 1 ? "point" : "points"}
                            {item.due_offset_days != null
                              ? ` · due ${dueOn(course.startDate, item.due_offset_days) ?? `${item.due_offset_days} days after the start`}`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-2 font-display text-[18px] font-black uppercase leading-none">{item.title}</h3>
                      {item.kind === "page" && item.body ? (
                        <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed">{item.body}</p>
                      ) : null}
                      {item.kind === "assignment" && item.brief ? (
                        <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed">{item.brief}</p>
                      ) : null}
                      {item.kind === "discussion" && item.prompt ? (
                        <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed">{item.prompt}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function StudentCourseStats({
  course,
  officialLetter,
}: {
  course: StudentCourseShape & { status?: string | null; creditHours?: number | null; description?: string | null };
  officialLetter: string | null;
}) {
  const letterValue = !course.graded ? "Not graded" : officialLetter ?? "Not posted";
  const letterReady = course.graded && !!officialLetter;
  return (
    <>
      <KpiStrip>
        <Kpi label="Official letter" value={letterValue} size={letterReady ? 54 : 18} lead tick={letterReady} />
        <Kpi label="Credit hours" value={String(course.creditHours ?? 0)} />
        <Kpi
          label="Starts"
          value={
            course.startDate
              ? new Date(`${course.startDate}T00:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
              : "No date"
          }
          size={course.startDate ? 28 : 18}
        />
        <Kpi label="Status" value={(course.status ?? "upcoming").replace(/_/g, " ")} size={18} />
      </KpiStrip>
      {course.description ? (
        <section>
          <SectionBar title="About this course" />
          <p className="whitespace-pre-wrap border-b border-rule px-5 py-4 text-[14px] leading-relaxed md:px-8">
            {course.description}
          </p>
        </section>
      ) : null}
    </>
  );
}
