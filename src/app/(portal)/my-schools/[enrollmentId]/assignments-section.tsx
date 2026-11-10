import Link from "next/link";
import { SectionBar, StatusPill } from "@/components/ffsa";
import { formatDue, formatPoints, type StudentAssignmentItem, type StudentBucket } from "@/lib/schools/lms-assignments";

// Student assignment list (LMS slice 2): To do / Submitted / Graded with due
// badges (Late in red). Server-rendered from the student's own rows; a
// grade appears only once released.

const GROUPS: Array<{ bucket: StudentBucket; title: string }> = [
  { bucket: "todo", title: "To do" },
  { bucket: "submitted", title: "Submitted" },
  { bucket: "graded", title: "Graded" },
];

function DueBadge({ item }: { item: StudentAssignmentItem }) {
  if (item.current?.is_late) return <StatusPill tone="bad">Late</StatusPill>;
  if (item.overdue) return <StatusPill tone="bad">{item.closed ? "Closed" : "Late"}</StatusPill>;
  if (!item.assignment.due_at) return null;
  return <StatusPill tone="quiet">Due {formatDue(item.assignment.due_at)}</StatusPill>;
}

export function AssignmentsSection({ enrollmentId, items }: { enrollmentId: string; items: StudentAssignmentItem[] }) {
  return (
    <section aria-labelledby="assignments-heading" className="px-5 pb-8 md:px-8">
      <div id="assignments-heading">
        <SectionBar title="Assignments" meta={`${items.length} ${items.length === 1 ? "assignment" : "assignments"}`} />
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">No assignments yet.</p>
      ) : (
        <div className="mt-4 space-y-6">
          {GROUPS.map(({ bucket, title }) => {
            const group = items.filter((i) => i.bucket === bucket);
            if (group.length === 0) return null;
            return (
              <div key={bucket}>
                <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">
                  {title} · {group.length}
                </h3>
                <ul className="mt-2 space-y-2">
                  {group.map((item) => (
                    <li key={item.assignment.id}>
                      <Link
                        href={`/my-schools/${enrollmentId}/assignments/${item.assignment.id}`}
                        className="flex min-h-11 items-center justify-between gap-3 border border-ink bg-white px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-semibold">{item.assignment.title}</span>
                          <span className="block text-[13px] text-[color:var(--text-secondary)]">
                            {item.grade
                              ? `${formatPoints(item.grade.points, item.assignment.max_points)}`
                              : item.current
                                ? `Attempt ${item.current.attempt_no} handed in`
                                : item.has_draft
                                  ? "Draft saved"
                                  : `${Number(item.assignment.max_points)} points`}
                          </span>
                        </span>
                        <DueBadge item={item} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
