import { ExternalLink } from "lucide-react";
import { SectionBar } from "@/components/ffsa";
import type { LmsCourseTree } from "@/lib/schools/lms-content";
import { sanitizeLessonBody } from "@/lib/schools/lms-render";

// Read-only Classroom for an enrolled student (LMS slice 1). The caller
// passes published content only. No edit controls.
export function ClassroomSection({ courses }: { courses: LmsCourseTree[] }) {
  return (
    <section aria-labelledby="classroom-heading" className="px-5 pb-8 md:px-8">
      <div id="classroom-heading">
        <SectionBar title="Classroom" meta={`${courses.length} ${courses.length === 1 ? "course" : "courses"}`} />
      </div>
      {courses.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">Nothing published for your school yet.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {courses.map((course) => (
            <details key={course.id} className="border border-ink bg-white" open={courses.length === 1}>
              <summary className="cursor-pointer px-4 py-3">
                <span className="text-[15px] font-semibold">{course.title}</span>
                {course.description && (
                  <span className="mt-1 block text-[13px] text-[color:var(--text-secondary)]">{course.description}</span>
                )}
              </summary>
              <div className="space-y-4 border-t border-rule px-4 py-3">
                {course.modules.length === 0 && (
                  <p className="text-sm text-muted-foreground">No modules yet.</p>
                )}
                {course.modules.map((m) => (
                  <div key={m.id}>
                    <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">
                      {m.title}
                    </h3>
                    <ol className="mt-2 space-y-2">
                      {m.lessons.map((l) => (
                        <li key={l.id} className="border border-rule px-3 py-2">
                          {l.content_type === "link" && l.link_url ? (
                            <a
                              href={l.link_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-2"
                            >
                              {l.title}
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                              <span className="sr-only">(opens in a new tab)</span>
                            </a>
                          ) : (
                            <details>
                              <summary className="cursor-pointer text-sm font-medium">{l.title}</summary>
                              <div
                                className="prose prose-sm mt-2 max-w-none text-[14px] [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                                dangerouslySetInnerHTML={{ __html: sanitizeLessonBody(l.body) }}
                              />
                            </details>
                          )}
                        </li>
                      ))}
                      {m.lessons.length === 0 && (
                        <li className="text-sm text-muted-foreground">No lessons yet.</li>
                      )}
                    </ol>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
