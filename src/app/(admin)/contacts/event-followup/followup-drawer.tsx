"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Check, CircleDashed, Clock, Mail, Tag, X } from "lucide-react";
import type { FollowupQueueRow, FollowupDetail } from "@/services/event-followup";
import type { AssignableFollowupHandler } from "@/lib/auth/assignable-followup-handlers";
import { SchedulingSection } from "./scheduling-section";
import { NotesSection } from "./notes-section";

const UNASSIGNED = "__none__";

export function FollowupDrawer({
  open,
  onClose,
  row,
  handlersByEvent,
  currentUserId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  row: FollowupQueueRow | null;
  handlersByEvent: Record<string, AssignableFollowupHandler[]>;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<FollowupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !row) {
      setDetail(null);
      return;
    }

    const enrollmentId = row.enrollment_id;
    const shouldMarkViewed =
      row.assigned_staff_id === currentUserId && !row.staff_viewed_at;

    let cancelled = false;
    setLoading(true);
    fetch(`/api/contacts/event-followup/${enrollmentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setDetail(data?.detail ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Mark viewed if assigned to me and unread (fire-and-forget)
    if (shouldMarkViewed) {
      fetch(`/api/contacts/event-followup/${enrollmentId}/view`, {
        method: "PUT",
      }).then(() => onChanged());
    }

    return () => {
      cancelled = true;
    };
    // Only re-fetch when the selected enrollment changes (or the drawer
    // opens). row/onChanged identities change on every parent render —
    // including them caused a re-fetch loop (skeleton↔loaded flicker).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.enrollment_id]);

  if (!row) return null;

  const handlers = handlersByEvent[row.event.id] ?? [];

  async function handleAssign(newStaffId: string | null) {
    if (!row) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/contacts/event-followup/${row.enrollment_id}/assign`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assigned_staff_id: newStaffId }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to assign");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkFinished() {
    if (!row) return;
    if (
      !confirm(
        "Mark this person as finished? They will drop out of the follow-up queue."
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/contacts/event-followup/${row.enrollment_id}/mark-finished`,
        { method: "PUT" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to mark finished");
        return;
      }
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="overflow-y-auto"
        style={{
          background: "#0A0A0A",
          borderColor: "hsl(22 8% 14%)",
          width: "100%",
          maxWidth: "560px",
        }}
      >
        <SheetHeader>
          <SheetTitle style={{ color: "#F0EBE3", fontSize: "18px" }}>
            {personLabel(row.contact)}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-2 space-y-1">
          {row.contact.email && (
            <div style={{ color: "#7C786C", fontSize: "13px" }}>
              {row.contact.email}
            </div>
          )}
          {row.contact.phone && (
            <div style={{ color: "#7C786C", fontSize: "13px" }}>
              {row.contact.phone}
            </div>
          )}
        </div>

        <div
          className="mt-5 rounded-lg p-4 space-y-3"
          style={{
            background: "#FFFFFF",
            border: "1px solid hsl(22 8% 14%)",
          }}
        >
          <KV label="Event" value={row.event.title} />
          <KV label="Outcome" value={row.outcome.name} />
          <KV label="Workflow" value={row.workflow.name} />
          <KV label="Stage" value={row.stage_label} />
          <KV
            label="Enrolled"
            value={`${row.days_in_pipeline} day${row.days_in_pipeline === 1 ? "" : "s"} ago`}
          />
        </div>

        <div className="mt-5 space-y-3">
          <Eyebrow label="Assignment" />
          <Select
            value={row.assigned_staff_id ?? UNASSIGNED}
            onValueChange={(v) =>
              handleAssign(v === UNASSIGNED ? null : v)
            }
            disabled={busy}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>
                <span className="text-muted-foreground">Unassigned</span>
              </SelectItem>
              {handlers.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {personLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {handlers.length === 0 && (
            <p
              style={{
                fontSize: "11px",
                color: "#55524A",
                fontStyle: "italic",
              }}
            >
              No one has the &ldquo;Event Follow-up Handler&rdquo; permission
              for this event yet. Grant it under Users → Permissions.
            </p>
          )}
        </div>

        <div className="mt-6">
          <NotesSection
            enrollmentId={row.enrollment_id}
            initialNotes={row.staff_notes}
            updatedAt={row.staff_notes_updated_at}
            updatedBy={row.staff_notes_updated_by}
            onSaved={onChanged}
          />
        </div>

        <div className="mt-6">
          <Eyebrow label="What they signed up for" />
          <div
            className="mt-2 rounded-lg p-4"
            style={{
              background: "#FFFFFF",
              border: "1px solid hsl(22 8% 14%)",
            }}
          >
            {loading ? (
              <Skeleton />
            ) : detail?.form_submission?.raw_data ? (
              <FormAnswers
                raw={detail.form_submission.raw_data}
                labels={detail.form_submission.field_labels ?? {}}
              />
            ) : (
              <p style={{ color: "#55524A", fontSize: "12px" }}>
                No form submission linked.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <Eyebrow label="Workflow trace" />
          <div className="mt-2 space-y-1">
            {loading ? (
              <Skeleton />
            ) : detail ? (
              <WorkflowTrace detail={detail} />
            ) : null}
          </div>
        </div>

        {detail && (
          <SchedulingSection
            enrollmentId={row.enrollment_id}
            scheduling={detail.scheduling}
            onChanged={() => {
              // Re-fetch detail without closing the drawer
              fetch(`/api/contacts/event-followup/${row.enrollment_id}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                  setDetail(data?.detail ?? null);
                  onChanged();
                });
            }}
          />
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            style={{
              borderColor: "hsl(22 8% 18%)",
              color: "#9A9689",
            }}
          >
            Close
          </Button>
          <Button
            onClick={handleMarkFinished}
            disabled={busy}
            style={{
              background: "#FFB801",
              color: "#0A0A0A",
              fontWeight: 700,
            }}
          >
            Mark finished
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

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

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span
        style={{
          fontSize: "10px",
          letterSpacing: "0.15em",
          fontWeight: 700,
          color: "#45423B",
          textTransform: "uppercase",
          minWidth: "80px",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: "13px", color: "#F0EBE3", textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function Eyebrow({ label }: { label: string }) {
  return (
    <p
      style={{
        fontSize: "9px",
        letterSpacing: "0.25em",
        fontWeight: 700,
        color: "#0A0A0A",
        textTransform: "uppercase",
      }}
    >
      {label}
    </p>
  );
}

function FormAnswers({
  raw,
  labels,
}: {
  raw: Record<string, unknown>;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(raw).filter(
    ([k]) => !["_meta", "ip", "user_agent"].includes(k.toLowerCase())
  );
  if (entries.length === 0) {
    return (
      <p style={{ color: "#55524A", fontSize: "12px" }}>
        Empty submission.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col gap-1">
          <span
            style={{
              fontSize: "10px",
              letterSpacing: "0.15em",
              fontWeight: 700,
              color: "#45423B",
              textTransform: "uppercase",
            }}
          >
            {labels[key] ?? key.replaceAll("_", " ")}
          </span>
          <span style={{ fontSize: "13px", color: "#F0EBE3" }}>
            {formatValue(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function WorkflowTrace({ detail }: { detail: FollowupDetail }) {
  const runByStep = new Map<string, (typeof detail.step_runs)[number]>();
  for (const r of detail.step_runs) {
    if (r.step_id && !runByStep.has(r.step_id)) {
      runByStep.set(r.step_id, r);
    }
  }

  if (detail.workflow_steps.length === 0) {
    return (
      <p style={{ color: "#55524A", fontSize: "12px" }}>
        This workflow has no steps configured.
      </p>
    );
  }

  return (
    <ol className="space-y-1.5 list-none p-0">
      {detail.workflow_steps.map((step, idx) => {
        const run = runByStep.get(step.id);
        const done = !!run && run.status === "done";
        const failed = !!run && run.status === "failed";
        const pending = !run && idx >= detail.current_step;
        const current = !run && idx === detail.current_step;

        const icon = done ? (
          <Check className="h-3.5 w-3.5" style={{ color: "hsl(142 60% 55%)" }} />
        ) : failed ? (
          <X className="h-3.5 w-3.5" style={{ color: "hsl(0 75% 60%)" }} />
        ) : current ? (
          <Clock
            className="h-3.5 w-3.5"
            style={{ color: "#0A0A0A" }}
          />
        ) : (
          <CircleDashed
            className="h-3.5 w-3.5"
            style={{ color: "#2A2822" }}
          />
        );

        const stepIcon =
          step.step_type === "send_email" ? (
            <Mail className="h-3 w-3 inline mr-1 opacity-60" />
          ) : step.step_type === "assign_label" ? (
            <Tag className="h-3 w-3 inline mr-1 opacity-60" />
          ) : (
            <Clock className="h-3 w-3 inline mr-1 opacity-60" />
          );

        return (
          <li
            key={step.id}
            className="flex items-start gap-3 rounded p-2"
            style={{
              background: current ? "hsl(42 30% 8%)" : "transparent",
              border: current
                ? "1px solid #FFF4D9"
                : "1px solid transparent",
            }}
          >
            <span className="mt-0.5">{icon}</span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: "12px",
                  color: pending ? "#55524A" : "#F0EBE3",
                }}
              >
                {stepIcon}
                {stepLabel(step)}
              </div>
              {run && (
                <div
                  style={{
                    fontSize: "10px",
                    color: "#45423B",
                    marginTop: "2px",
                  }}
                >
                  {new Date(run.ran_at).toLocaleString()}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function stepLabel(s: {
  step_type: string;
  config: Record<string, unknown> | null;
}): string {
  const c = (s.config ?? {}) as Record<string, unknown>;
  if (s.step_type === "send_email") {
    return `Send email: ${(c.subject as string) ?? "(no subject)"}`;
  }
  if (s.step_type === "delay") {
    return `Wait ${(c.days as number) ?? 0} day${c.days === 1 ? "" : "s"}`;
  }
  if (s.step_type === "assign_label") {
    return `Assign label`;
  }
  return s.step_type;
}

function Skeleton() {
  return (
    <div className="space-y-2">
      <div
        style={{
          height: "12px",
          background: "#0A0A0A",
          borderRadius: 0,
          width: "60%",
        }}
      />
      <div
        style={{
          height: "12px",
          background: "#0A0A0A",
          borderRadius: 0,
          width: "80%",
        }}
      />
      <div
        style={{
          height: "12px",
          background: "#0A0A0A",
          borderRadius: 0,
          width: "50%",
        }}
      />
    </div>
  );
}
