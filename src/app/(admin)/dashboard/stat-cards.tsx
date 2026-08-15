import { KpiStrip, Kpi } from "@/components/ffsa";

// The dashboard's headline numbers. Rendered as the design's KPI strip: one
// bordered band of four cells, the first carrying the bone lead treatment.
export function StatCards({
  contacts,
  events,
  users,
  recentRegistrations,
}: {
  contacts: number;
  events: number;
  users: number;
  recentRegistrations: number;
}) {
  return (
    <div className="border-x border-t border-ink">
      <KpiStrip>
        <Kpi label="Active contacts" value={String(contacts)} lead />
        <Kpi label="Published events" value={String(events)} />
        <Kpi label="Active users" value={String(users)} />
        <Kpi label="Recent registrations" value={String(recentRegistrations)} />
      </KpiStrip>
    </div>
  );
}
