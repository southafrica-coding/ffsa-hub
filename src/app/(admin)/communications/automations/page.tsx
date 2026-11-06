import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { listAllWorkflows } from "@/services/workflows";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Masthead, SectionBar, StatusPill } from "@/components/ffsa";

// Communications → Automations: every outcome workflow across all events.
// Editing happens on the event's Outcomes tab; this is the cross-event view.
export default async function AutomationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "communications");

  const [{ data: workflows }, { data: activeEnrollments }] = await Promise.all([
    listAllWorkflows(supabase),
    supabase.from("workflow_enrollments").select("workflow_id").eq("status", "active"),
  ]);

  const activeCount = new Map<string, number>();
  for (const e of (activeEnrollments ?? []) as Array<{ workflow_id: string }>) {
    activeCount.set(e.workflow_id, (activeCount.get(e.workflow_id) ?? 0) + 1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (workflows ?? []) as any[];

  return (
    <div className="ffsa-screen">
      <Masthead context="Announcements & Outreach" title="Automations" />

      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="mb-5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          Every outcome workflow across all events. Edit one on its event&apos;s
          Outcomes tab.
        </p>

        <div className="border border-ink bg-white">
          <SectionBar
            title="Workflows"
            meta={`${rows.length} across all events`}
          />
          <div className="md:hidden">
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs tracking-[0.05em] text-[color:var(--text-tertiary)]">
                No workflows yet. Create one on an event&apos;s Outcomes tab.
              </p>
            ) : (
              rows.map((w) => {
                const outcome = w.event_outcomes;
                const eventId: string | undefined = outcome?.event_id;
                const eventTitle: string = outcome?.events?.title ?? "—";
                const stepCount: number = w.workflow_steps?.[0]?.count ?? 0;
                const active = activeCount.get(w.id) ?? 0;
                return (
                  <div
                    key={w.id}
                    className="border-b border-rule px-4 py-3.5 last:border-b-0"
                  >
                    <div className="break-words font-display text-[20px] font-black uppercase leading-none">
                      {w.name}
                    </div>
                    <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
                      {eventTitle} · {outcome?.name ?? "—"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="mono-label">
                        {stepCount} {stepCount === 1 ? "step" : "steps"}
                      </span>
                      <span className="mono-label">{active} active</span>
                      <StatusPill tone={w.is_active ? "good" : "quiet"}>
                        {w.is_active ? "Active" : "Paused"}
                      </StatusPill>
                    </div>
                    {eventId ? (
                      <Link
                        href={`/events/${eventId}?tab=outcomes`}
                        className="mt-3 inline-flex min-h-11 items-center font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-primary)] underline"
                      >
                        Open
                      </Link>
                    ) : (
                      <p className="mono-label mt-3">No event link</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Event · Outcome</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-xs tracking-[0.05em] text-[color:var(--text-tertiary)]"
                    >
                      No workflows yet. Create one on an event&apos;s Outcomes tab.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((w) => {
                    const outcome = w.event_outcomes;
                    const eventId: string | undefined = outcome?.event_id;
                    const eventTitle: string = outcome?.events?.title ?? "—";
                    const stepCount: number = w.workflow_steps?.[0]?.count ?? 0;
                    return (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium">{w.name}</TableCell>
                        <TableCell className="text-[color:var(--text-secondary)]">
                          {eventTitle} · {outcome?.name ?? "—"}
                        </TableCell>
                        <TableCell className="tabular">{stepCount}</TableCell>
                        <TableCell className="tabular">
                          {activeCount.get(w.id) ?? 0}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={w.is_active ? "good" : "quiet"}>
                            {w.is_active ? "Active" : "Paused"}
                          </StatusPill>
                        </TableCell>
                        <TableCell className="text-right">
                          {eventId ? (
                            <Link
                              href={`/events/${eventId}?tab=outcomes`}
                              className="mono-label !text-[color:var(--text-primary)] hover:underline"
                            >
                              Open →
                            </Link>
                          ) : (
                            <span className="text-[color:var(--text-tertiary)]">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
