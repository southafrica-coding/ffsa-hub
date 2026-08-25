"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FollowupQueueRow } from "@/services/event-followup";
import type { AssignableFollowupHandler } from "@/lib/auth/assignable-followup-handlers";
import { FollowupDrawer } from "./followup-drawer";
import { ExportPanel, OutcomeDownloadButtons } from "./export-panel";

type AssignmentFilter = "all" | "unassigned" | "mine";
type AgingFilter = "all" | "attention";

export function FollowupQueue({
  queue,
  handlersByEvent,
  currentUserId,
}: {
  queue: FollowupQueueRow[];
  handlersByEvent: Record<string, AssignableFollowupHandler[]>;
  currentUserId: string;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignmentFilter, setAssignmentFilter] =
    useState<AssignmentFilter>("all");
  const [agingFilter, setAgingFilter] = useState<AgingFilter>("all");
  const [eventFilter, setEventFilter] = useState<string>("all");

  const events = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of queue) map.set(r.event.id, r.event.title);
    return Array.from(map.entries())
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [queue]);

  const filtered = useMemo(() => {
    return queue.filter((r) => {
      if (assignmentFilter === "unassigned" && r.assigned_staff_id) return false;
      if (
        assignmentFilter === "mine" &&
        r.assigned_staff_id !== currentUserId
      )
        return false;
      if (agingFilter === "attention" && r.days_in_pipeline < 3) return false;
      if (eventFilter !== "all" && r.event.id !== eventFilter) return false;
      return true;
    });
  }, [queue, assignmentFilter, agingFilter, eventFilter, currentUserId]);

  const selected = useMemo(
    () => queue.find((r) => r.enrollment_id === selectedId) ?? null,
    [queue, selectedId]
  );

  // Group filtered rows by event so concurrent events stay separated.
  // Sections are sorted alphabetically by event title; rows inside
  // each section keep the upstream "enrolled_at DESC" order.
  const groupedByEvent = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; title: string; rows: FollowupQueueRow[] }
    >();
    for (const r of filtered) {
      const existing = groups.get(r.event.id);
      if (existing) {
        existing.rows.push(r);
      } else {
        groups.set(r.event.id, {
          id: r.event.id,
          title: r.event.title,
          rows: [r],
        });
      }
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }, [filtered]);

  function onRowChanged() {
    router.refresh();
  }

  return (
    <>
      <FilterBar
        assignmentFilter={assignmentFilter}
        onAssignmentChange={setAssignmentFilter}
        agingFilter={agingFilter}
        onAgingChange={setAgingFilter}
        eventFilter={eventFilter}
        onEventChange={setEventFilter}
        events={events}
        unassignedCount={queue.filter((r) => !r.assigned_staff_id).length}
        mineCount={
          queue.filter((r) => r.assigned_staff_id === currentUserId).length
        }
        attentionCount={
          queue.filter((r) => r.days_in_pipeline >= 3).length
        }
      />

      {groupedByEvent.length === 0 ? (
        <div
          className=""
          style={{
            background: "#FFFFFF",
            border: "1px solid var(--rule)",
            textAlign: "center",
            padding: "3rem 1rem",
            color: "#45423B",
            fontSize: "13px",
          }}
        >
          No follow-ups match your filters.
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByEvent.map((group) => (
            <EventGroup
              key={group.id}
              eventId={group.id}
              eventTitle={group.title}
              rows={group.rows}
              onRowClick={(id) => setSelectedId(id)}
            />
          ))}
        </div>
      )}

      <FollowupDrawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        row={selected}
        handlersByEvent={handlersByEvent}
        currentUserId={currentUserId}
        onChanged={onRowChanged}
      />
    </>
  );
}

const th: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "0.15em",
  fontWeight: 700,
  color: "#45423B",
  textTransform: "uppercase",
  padding: "12px 16px",
};

function personLabel(p: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email?: string | null;
}) {
  const first = p.preferred_name || p.first_name || "";
  const last = p.last_name || "";
  const name = `${first} ${last}`.trim();
  return name || p.email || "—";
}

function AgeBadge({ days }: { days: number }) {
  const palette =
    days >= 7
      ? { bg: "transparent", fg: "hsl(var(--destructive))" }
      : days >= 3
      ? { bg: "var(--yellow-dim)", fg: "#0A0A0A" }
      : { bg: "#F1EFE7", fg: "#7C786C" };
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.05em",
        padding: "3px 8px",
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {days}d
    </span>
  );
}

function FilterBar({
  assignmentFilter,
  onAssignmentChange,
  agingFilter,
  onAgingChange,
  eventFilter,
  onEventChange,
  events,
  unassignedCount,
  mineCount,
  attentionCount,
}: {
  assignmentFilter: AssignmentFilter;
  onAssignmentChange: (v: AssignmentFilter) => void;
  agingFilter: AgingFilter;
  onAgingChange: (v: AgingFilter) => void;
  eventFilter: string;
  onEventChange: (v: string) => void;
  events: { id: string; title: string }[];
  unassignedCount: number;
  mineCount: number;
  attentionCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip
        active={assignmentFilter === "all"}
        onClick={() => onAssignmentChange("all")}
        label="All"
      />
      <Chip
        active={assignmentFilter === "unassigned"}
        onClick={() => onAssignmentChange("unassigned")}
        label="Unassigned"
        count={unassignedCount}
      />
      <Chip
        active={assignmentFilter === "mine"}
        onClick={() => onAssignmentChange("mine")}
        label="Mine"
        count={mineCount}
      />
      <div style={{ width: "1px", height: "20px", background: "var(--rule-strong)", margin: "0 4px" }} />
      <Chip
        active={agingFilter === "attention"}
        onClick={() =>
          onAgingChange(agingFilter === "attention" ? "all" : "attention")
        }
        label="Aging > 3d"
        count={attentionCount}
      />
      {events.length > 1 && (
        <>
          <div style={{ width: "1px", height: "20px", background: "var(--rule-strong)", margin: "0 4px" }} />
          <select
            value={eventFilter}
            onChange={(e) => onEventChange(e.target.value)}
            style={{
              fontSize: "12px",
              padding: "6px 10px",
              border: "1px solid var(--rule-strong)",
              background: "#F4F2EA",
              color: "var(--text-primary)",
            }}
          >
            <option value="all">All events</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

function EventGroup({
  eventId,
  eventTitle,
  rows,
  onRowClick,
}: {
  eventId: string;
  eventTitle: string;
  rows: FollowupQueueRow[];
  onRowClick: (enrollmentId: string) => void;
}) {
  // Every outcome chosen by anyone in this event's queue (union of each
  // contact's full form selection), for the outcome filter + per-outcome
  // export — so all of the event's outcomes appear, not just the ones whose
  // workflow is still active. Falls back to the row's own outcome.
  const outcomes: { id: string; name: string }[] = [];
  const seenOutcome = new Set<string>();
  for (const r of rows) {
    const chosen = r.chosen_outcomes ?? [];
    const list = chosen.length
      ? chosen.map((o) => ({ id: o.id, name: o.name }))
      : [{ id: r.outcome.id, name: r.outcome.name }];
    for (const o of list) {
      if (!seenOutcome.has(o.id)) {
        seenOutcome.add(o.id);
        outcomes.push(o);
      }
    }
  }
  return (
    <section
      className="overflow-hidden "
      style={{
        background: "#FFFFFF",
        border: "1px solid var(--rule)",
      }}
    >
      <header
        className="flex items-center justify-between gap-4"
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--rule)",
          background: "#FFFFFF",
        }}
      >
        <div className="flex items-baseline gap-3">
          <h2
            style={{
              color: "var(--text-primary)",
              fontSize: "15px",
              fontWeight: 700,
              letterSpacing: "0.01em",
            }}
          >
            {eventTitle}
          </h2>
          <span
            style={{
              color: "#55524A",
              fontSize: "11px",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {rows.length} active · all data
          </span>
        </div>
        <ExportPanel eventId={eventId} outcomes={outcomes} />
      </header>
      {outcomes.length > 0 && (
        <div
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--rule)",
            background: "#FFFFFF",
          }}
        >
          <OutcomeDownloadButtons eventId={eventId} outcomes={outcomes} />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow style={{ borderColor: "var(--rule)" }}>
            <TableHead style={th}>Person</TableHead>
            <TableHead style={th}>Outcome</TableHead>
            <TableHead style={th}>Stage</TableHead>
            <TableHead style={{ ...th, textAlign: "right" }}>Age</TableHead>
            <TableHead style={th}>Assigned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.enrollment_id}
              onClick={() => onRowClick(r.enrollment_id)}
              style={{
                cursor: "pointer",
                borderColor: "var(--rule)",
                background: r.is_unread ? "var(--yellow-dim)" : "transparent",
              }}
              className="hover:bg-white/5"
            >
              <TableCell>
                <div
                  className="flex items-center gap-2"
                  style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: 500 }}
                >
                  {personLabel(r.contact)}
                  {r.staff_notes && (
                    <span
                      title="Has staff notes"
                      style={{ color: "#0A0A0A", display: "inline-flex" }}
                    >
                      <StickyNote className="h-3 w-3" />
                    </span>
                  )}
                </div>
                {r.contact.email && (
                  <div style={{ color: "#55524A", fontSize: "11px" }}>
                    {r.contact.email}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <div
                  className="flex flex-wrap gap-1"
                  style={{ maxWidth: "240px" }}
                >
                  {((r.chosen_outcomes ?? []).length
                    ? r.chosen_outcomes ?? []
                    : [{ id: r.outcome.id, name: r.outcome.name, active: true }]
                  ).map((o) => (
                    <span
                      key={o.id}
                      title={
                        o.active
                          ? "Active follow-up"
                          : "Chosen on the form — workflow already finished"
                      }
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 600,
                        padding: "2px 7px",
                        lineHeight: 1.35,
                        background: o.active
                          ? "var(--yellow-dim)"
                          : "var(--rule)",
                        color: o.active ? "#0A0A0A" : "#7C786C",
                        border: o.active
                          ? "1px solid var(--yellow-dim)"
                          : "1px solid transparent",
                      }}
                    >
                      {o.name}
                    </span>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <div style={{ color: "#9A9689", fontSize: "12px" }}>
                  {r.stage_label}
                </div>
                {r.total_steps > 0 && (
                  <div
                    style={{
                      color: "#45423B",
                      fontSize: "10px",
                      letterSpacing: "0.05em",
                      marginTop: "2px",
                    }}
                  >
                    Step {Math.min(r.steps_done + 1, r.total_steps)} of {r.total_steps}
                  </div>
                )}
              </TableCell>
              <TableCell style={{ textAlign: "right" }}>
                <AgeBadge days={r.days_in_pipeline} />
              </TableCell>
              <TableCell>
                {r.assigned_staff ? (
                  <span style={{ color: "var(--text-primary)", fontSize: "12px" }}>
                    {personLabel(r.assigned_staff)}
                  </span>
                ) : (
                  <span
                    style={{
                      color: "#0A0A0A",
                      fontSize: "11px",
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                    }}
                  >
                    Unassigned
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: "12px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        padding: "6px 12px",
        border: active
          ? "1px solid #0A0A0A"
          : "1px solid var(--rule-strong)",
        background: active ? "#FFF4D9" : "#F4F2EA",
        color: active ? "#0A0A0A" : "#9A9689",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
      }}
    >
      {label}
      {count !== undefined && (
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            padding: "1px 6px",
            background: active ? "#FFB801" : "var(--rule-strong)",
            color: active ? "#0A0A0A" : "#9A9689",
            lineHeight: 1,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
