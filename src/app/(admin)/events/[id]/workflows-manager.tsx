"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Clock,
  Mail,
  Pencil,
  Plus,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { EmailBlockComposer } from "@/components/communications/email-block-composer";
import type { CampaignBody } from "@/lib/campaigns/blocks";
import type {
  WorkflowTrigger,
  WorkflowStepType,
  WorkflowSchedulerConfig,
} from "@/lib/workflows/types";

type TriggerField = { key: string; label: string };
type StepDraft = { step_type: WorkflowStepType; config: Record<string, unknown> };
type WorkflowRow = {
  id: string;
  name: string;
  trigger: WorkflowTrigger | null;
  is_active: boolean;
  workflow_steps: Array<{
    id: string;
    sort_order: number;
    step_type: string;
    config: Record<string, unknown>;
  }>;
};

type Draft = {
  id?: string;
  name: string;
  trigger: WorkflowTrigger;
  is_active: boolean;
  steps: StepDraft[];
};

type Props = {
  eventId: string;
  outcomeId: string;
  outcomeName: string;
  outcomeLabelId: string | null;
  hasForm: boolean;
  labelOptions: Array<{ id: string; name: string }>;
  identityOptions: Array<{ id: string; label: string }>;
  triggerFields: TriggerField[];
  initialWorkflows: WorkflowRow[];
};

const selectClass =
  "h-9 border border-input bg-transparent px-2 text-sm w-full";

function emptyDraft(): Draft {
  return {
    name: "",
    trigger: { type: "on_submit" },
    is_active: true,
    steps: [],
  };
}

function rowToDraft(w: WorkflowRow): Draft {
  return {
    id: w.id,
    name: w.name,
    trigger: w.trigger ?? { type: "on_submit" },
    is_active: w.is_active,
    steps: [...w.workflow_steps]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({
        step_type: s.step_type as WorkflowStepType,
        config: migrateStepConfig(s.step_type, s.config ?? {}),
      })),
  };
}

// Promote legacy assign_label `{ label_id }` rows into the multi-label
// `{ label_ids: [...] }` shape so the editor renders them correctly.
function migrateStepConfig(
  stepType: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  if (stepType !== "assign_label") return config;
  if (Array.isArray(config.label_ids)) return config;
  const legacy = typeof config.label_id === "string" ? config.label_id : null;
  return { ...config, label_ids: legacy ? [legacy] : [] };
}

export function WorkflowsManager({
  eventId,
  outcomeId,
  outcomeName,
  outcomeLabelId,
  hasForm,
  labelOptions: initialLabelOptions,
  identityOptions,
  triggerFields,
  initialWorkflows,
}: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  // Local copy so labels created inline from the picker appear in the
  // dropdown immediately, without waiting for a router refresh.
  const [labelOptions, setLabelOptions] = useState(initialLabelOptions);

  const base = `/api/events/${eventId}/outcomes/${outcomeId}/workflows`;

  async function createLabel(name: string): Promise<{ id: string; name: string } | null> {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the label a name");
      return null;
    }
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        name?: string;
        error?: string;
      };
      if (!res.ok || !data.id || !data.name) {
        throw new Error(data.error ?? "Create failed");
      }
      const next = { id: data.id, name: data.name };
      setLabelOptions((prev) =>
        prev.some((l) => l.id === next.id) ? prev : [...prev, next].sort((a, b) => a.name.localeCompare(b.name))
      );
      toast.success(`Label "${next.name}" created`);
      return next;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
      return null;
    }
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Give the workflow a name");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        trigger: draft.trigger,
        is_active: draft.is_active,
        steps: draft.steps,
      };
      const res = await fetch(draft.id ? `${base}/${draft.id}` : base, {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Save failed");
      }
      toast.success(draft.id ? "Workflow updated" : "Workflow created");
      setDraft(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this workflow? Active enrollments stop running.")) return;
    const res = await fetch(`${base}/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Workflow deleted");
      router.refresh();
    } else {
      toast.error("Delete failed");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Workflows</p>
        <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New workflow
        </Button>
      </div>

      {initialWorkflows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No workflows yet. A workflow sends an automated sequence when someone
          responds to this outcome.
        </p>
      ) : (
        <div className="space-y-2">
          {initialWorkflows.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{w.name}</span>
                  {!w.is_active && (
                    <Badge variant="outline" className="text-xs">
                      Paused
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {triggerSummary(w.trigger, triggerFields)} ·{" "}
                  {w.workflow_steps.length} step
                  {w.workflow_steps.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft(rowToDraft(w))}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(w.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {draft?.id ? "Edit workflow" : "New workflow"} · {outcomeName}
            </SheetTitle>
          </SheetHeader>

          {draft && (
            <div className="space-y-5 px-4 pb-8">
              <Field label="Name">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Bible study nurture"
                />
              </Field>

              <TriggerEditor
                trigger={draft.trigger}
                onChange={(trigger) => setDraft({ ...draft, trigger })}
                triggerFields={triggerFields}
                outcomeLabelId={outcomeLabelId}
                hasForm={hasForm}
              />

              <StepsEditor
                steps={draft.steps}
                onChange={(steps) => setDraft({ ...draft, steps })}
                labelOptions={labelOptions}
                identityOptions={identityOptions}
                onCreateLabel={createLabel}
              />

              <label className="flex items-center gap-2 text-sm select-none">
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(e) =>
                    setDraft({ ...draft, is_active: e.target.checked })
                  }
                  className=""
                />
                Active (enrolls new responders)
              </label>

              <div className="flex gap-2">
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : draft.id ? "Save changes" : "Create workflow"}
                </Button>
                <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Trigger editor ───────────────────────────────────────────

function TriggerEditor({
  trigger,
  onChange,
  triggerFields,
  outcomeLabelId,
  hasForm,
}: {
  trigger: WorkflowTrigger;
  onChange: (t: WorkflowTrigger) => void;
  triggerFields: TriggerField[];
  outcomeLabelId: string | null;
  hasForm: boolean;
}) {
  return (
    <Field label="Trigger — when does someone enter this workflow?">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={trigger.type === "on_submit"}
            onChange={() => onChange({ type: "on_submit" })}
            disabled={!hasForm}
          />
          When the outcome&apos;s form is submitted
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={trigger.type === "answer"}
            onChange={() =>
              onChange({
                type: "answer",
                field_key: triggerFields[0]?.key ?? "",
                op: "eq",
                value: "Yes",
              })
            }
            disabled={!hasForm || triggerFields.length === 0}
          />
          When an answer matches a value
        </label>
        {trigger.type === "answer" && (
          <div className="ml-6 flex flex-wrap items-center gap-2">
            <select
              className={`${selectClass} max-w-[220px]`}
              value={trigger.field_key}
              onChange={(e) => onChange({ ...trigger, field_key: e.target.value })}
            >
              {triggerFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">equals</span>
            <Input
              value={String(trigger.value)}
              onChange={(e) => onChange({ ...trigger, value: e.target.value })}
              placeholder="Yes"
              className="max-w-[160px]"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={trigger.type === "label_added"}
            onChange={() =>
              onChange({ type: "label_added", label_id: outcomeLabelId ?? "" } as WorkflowTrigger)
            }
            disabled={!outcomeLabelId}
          />
          When this outcome&apos;s label is added to a contact
          {!outcomeLabelId && (
            <span className="text-xs text-muted-foreground">
              (set a label on the outcome first)
            </span>
          )}
        </label>
      </div>
    </Field>
  );
}

// ── Steps editor ─────────────────────────────────────────────

function StepsEditor({
  steps,
  onChange,
  labelOptions,
  identityOptions,
  onCreateLabel,
}: {
  steps: StepDraft[];
  onChange: (s: StepDraft[]) => void;
  labelOptions: Array<{ id: string; name: string }>;
  identityOptions: Array<{ id: string; label: string }>;
  onCreateLabel: (name: string) => Promise<{ id: string; name: string } | null>;
}) {
  const add = (step_type: WorkflowStepType) => {
    const config: Record<string, unknown> =
      step_type === "send_email"
        ? { subject: "", body: { version: 1, blocks: [] } }
        : step_type === "delay"
          ? { days: 14 }
          : { label_ids: [] };
    onChange([...steps, { step_type, config }]);
  };
  const patch = (i: number, config: Record<string, unknown>) =>
    onChange(steps.map((s, idx) => (idx === i ? { ...s, config } : s)));
  const remove = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <Field label="Steps — run top to bottom">
      <div className="space-y-3">
        {steps.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No steps yet. Add an email, a delay, or a label.
          </p>
        )}
        {steps.map((step, i) => (
          <div key={i} className="border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <StepIcon type={step.step_type} />
                {stepTitle(step.step_type)}
              </div>
              <div className="flex gap-1">
                <MiniBtn onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </MiniBtn>
                <MiniBtn onClick={() => move(i, 1)} disabled={i === steps.length - 1}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </MiniBtn>
                <MiniBtn onClick={() => remove(i)} danger>
                  <Trash2 className="h-3.5 w-3.5" />
                </MiniBtn>
              </div>
            </div>

            {step.step_type === "send_email" && (
              <div className="space-y-2">
                <Input
                  value={(step.config.subject as string) ?? ""}
                  onChange={(e) => patch(i, { ...step.config, subject: e.target.value })}
                  placeholder="Email subject"
                />
                {identityOptions.length > 0 && (
                  <select
                    className={selectClass}
                    value={(step.config.sending_identity_id as string) ?? ""}
                    onChange={(e) =>
                      patch(i, {
                        ...step.config,
                        sending_identity_id: e.target.value || null,
                      })
                    }
                  >
                    <option value="">Default sender (outcome label&apos;s identity)</option>
                    {identityOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                <EmailBlockComposer
                  value={(step.config.body as CampaignBody) ?? { version: 1, blocks: [] }}
                  onChange={(body) => patch(i, { ...step.config, body })}
                />
                <SchedulerToggle
                  scheduler={step.config.scheduler as WorkflowSchedulerConfig | undefined}
                  onChange={(scheduler) => patch(i, { ...step.config, scheduler })}
                />
              </div>
            )}

            {step.step_type === "delay" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Wait</span>
                <Input
                  type="number"
                  min={0}
                  value={String((step.config.days as number) ?? 0)}
                  onChange={(e) =>
                    patch(i, { ...step.config, days: Math.max(0, Number(e.target.value)) })
                  }
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            )}

            {step.step_type === "assign_label" && (
              <MultiLabelPicker
                labelOptions={labelOptions}
                selectedIds={readLabelIds(step.config)}
                onChange={(ids) => patch(i, { ...step.config, label_ids: ids, label_id: undefined })}
                onCreateLabel={onCreateLabel}
              />
            )}
          </div>
        ))}

        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => add("send_email")}>
            <Mail className="h-3.5 w-3.5 mr-1" /> Email
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => add("delay")}>
            <Clock className="h-3.5 w-3.5 mr-1" /> Delay
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => add("assign_label")}>
            <Tag className="h-3.5 w-3.5 mr-1" /> Assign label
          </Button>
        </div>
      </div>
    </Field>
  );
}

// ── Multi-label picker ───────────────────────────────────────
// Reads either the new `label_ids` array or the legacy `label_id` scalar so
// in-flight edits of older workflows don't lose their selection.
function readLabelIds(config: Record<string, unknown>): string[] {
  if (Array.isArray(config.label_ids)) {
    return config.label_ids.filter((id): id is string => typeof id === "string");
  }
  if (typeof config.label_id === "string" && config.label_id) return [config.label_id];
  return [];
}

function MultiLabelPicker({
  labelOptions,
  selectedIds,
  onChange,
  onCreateLabel,
}: {
  labelOptions: Array<{ id: string; name: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onCreateLabel: (name: string) => Promise<{ id: string; name: string } | null>;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = selectedIds
    .map((id) => labelOptions.find((o) => o.id === id))
    .filter((o): o is { id: string; name: string } => !!o);

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  };

  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    const created = await onCreateLabel(newName);
    setCreating(false);
    if (created) {
      if (!selectedIds.includes(created.id)) {
        onChange([...selectedIds, created.id]);
      }
      setNewName("");
    }
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between border border-input bg-transparent px-2 text-sm hover:bg-accent/40"
          >
            <span className={selected.length ? "" : "text-muted-foreground"}>
              {selected.length === 0
                ? "Select labels…"
                : `${selected.length} label${selected.length === 1 ? "" : "s"} selected`}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="max-h-60 overflow-y-auto p-2">
            {labelOptions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No labels yet — create one below.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {labelOptions.map((o) => {
                  const checked = selectedIds.includes(o.id);
                  return (
                    <li key={o.id}>
                      <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(o.id)}
                        />
                        <span className="truncate">{o.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t p-2">
            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Create new label
            </p>
            <div className="flex gap-1.5">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreate();
                  }
                }}
                placeholder="Label name"
                className="h-8 text-sm"
                disabled={creating}
              />
              <Button
                type="button"
                size="sm"
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
              >
                {creating ? "…" : <Plus className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((o) => (
            <Badge
              key={o.id}
              variant="secondary"
              className="gap-1 pr-1 text-xs font-normal"
            >
              {o.name}
              <button
                type="button"
                onClick={() => remove(o.id)}
                className="hover:bg-background/60"
                aria-label={`Remove ${o.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── small helpers ────────────────────────────────────────────

function SchedulerToggle({
  scheduler,
  onChange,
}: {
  scheduler: WorkflowSchedulerConfig | undefined;
  onChange: (s: WorkflowSchedulerConfig) => void;
}) {
  const enabled = !!scheduler?.enabled;
  const base: WorkflowSchedulerConfig = scheduler ?? { enabled: true };
  return (
    <div className="border bg-muted/30 p-2.5 space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange({ ...base, enabled: e.target.checked })
          }
        />
        📅 Ask for their availability — adds a “pick a time” button
      </label>
      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-2 pl-6">
            <label className="text-xs text-muted-foreground space-y-1 block">
              <span>Call length (min)</span>
              <Input
                type="number"
                min={5}
                value={String(scheduler?.durationMinutes ?? 30)}
                onChange={(e) =>
                  onChange({ ...base, durationMinutes: Math.max(5, Number(e.target.value)) })
                }
              />
            </label>
            <label className="text-xs text-muted-foreground space-y-1 block">
              <span>Booking window (days)</span>
              <Input
                type="number"
                min={1}
                value={String(scheduler?.windowDays ?? 14)}
                onChange={(e) =>
                  onChange({ ...base, windowDays: Math.max(1, Number(e.target.value)) })
                }
              />
            </label>
            <label className="text-xs text-muted-foreground space-y-1 block col-span-2">
              <span>Button label</span>
              <Input
                value={scheduler?.buttonText ?? "Choose a time that works"}
                onChange={(e) => onChange({ ...base, buttonText: e.target.value })}
              />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground pl-6">
            The recipient picks times on a Calendly-style page; their choices land
            on the contact&apos;s Event Follow-up profile.
          </p>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}

function MiniBtn({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 w-7 items-center justify-center border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed ${
        danger ? "hover:text-destructive" : ""
      }`}
    >
      {children}
    </button>
  );
}

function StepIcon({ type }: { type: WorkflowStepType }) {
  if (type === "send_email") return <Mail className="h-4 w-4" />;
  if (type === "delay") return <Clock className="h-4 w-4" />;
  return <Tag className="h-4 w-4" />;
}

function stepTitle(type: WorkflowStepType): string {
  if (type === "send_email") return "Send email";
  if (type === "delay") return "Delay";
  return "Assign label";
}

function triggerSummary(
  trigger: WorkflowTrigger | null,
  fields: TriggerField[]
): string {
  if (!trigger || trigger.type === "on_submit") return "On form submit";
  if (trigger.type === "answer") {
    const label = fields.find((f) => f.key === trigger.field_key)?.label ?? trigger.field_key;
    return `When ${label} = ${trigger.value}`;
  }
  if (trigger.type === "label_added") return "When label added";
  return "Trigger";
}
