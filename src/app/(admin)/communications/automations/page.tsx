import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { listAllWorkflows } from "@/services/workflows";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="page-eyebrow">ANNOUNCEMENTS &amp; OUTREACH</p>
          <h1 className="page-title">Automations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every outcome workflow across all events. Edit one on its event&apos;s
            Outcomes tab.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
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
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
                      <TableCell className="text-muted-foreground">
                        {eventTitle} · {outcome?.name ?? "—"}
                      </TableCell>
                      <TableCell>{stepCount}</TableCell>
                      <TableCell>{activeCount.get(w.id) ?? 0}</TableCell>
                      <TableCell>
                        {w.is_active ? (
                          <Badge>Active</Badge>
                        ) : (
                          <Badge variant="outline">Paused</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {eventId ? (
                          <Link
                            href={`/events/${eventId}?tab=outcomes`}
                            className="text-blue-600 hover:underline text-sm"
                          >
                            Open →
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
