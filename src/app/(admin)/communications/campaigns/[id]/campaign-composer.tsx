"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, GripVertical, Sparkles } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CampaignBlock,
  type CampaignBlockType,
  type CampaignBody,
  type ButtonStyle,
  type DividerStyle,
  type SpacerSize,
  newBlockId,
  renderCampaignHtml,
} from "@/lib/campaigns/blocks";
import {
  CAMPAIGN_TEMPLATES,
  getCampaignTemplate,
} from "@/lib/campaigns/templates";
import type { EffectiveBrand } from "@/services/brand";
import { RichText } from "@/components/communications/rich-text";

type Label = { id: string; slug: string; name: string };
type Identity = { id: string; display_name: string; from_email: string };

type CampaignMeta = {
  id: string;
  name: string;
  subject: string;
  preview_text: string;
  label_ids: string[];
  sending_identity_id: string | null;
  status: string;
  scheduled_at: string | null;
};

const ADD_GROUPS: {
  group: string;
  items: { type: CampaignBlockType; label: string }[];
}[] = [
  {
    group: "Layout",
    items: [
      { type: "heading", label: "Heading" },
      { type: "text", label: "Text" },
      { type: "eyebrow", label: "Eyebrow" },
      { type: "quote", label: "Pull quote" },
      { type: "divider", label: "Divider" },
      { type: "spacer", label: "Spacer" },
    ],
  },
  {
    group: "Media",
    items: [
      { type: "image", label: "Image" },
      { type: "image-text", label: "Image + text" },
    ],
  },
  {
    group: "Action",
    items: [
      { type: "button", label: "Button" },
      { type: "cta", label: "CTA card" },
    ],
  },
];

const STATUS_CLASS: Record<string, string> = {
  draft: "status-grey",
  scheduled: "status-yellow",
  sending: "status-yellow",
  sent: "status-green",
  failed: "status-red",
  cancelled: "status-grey",
};

export function CampaignComposer({
  campaign,
  initialBody,
  labels,
  identities,
  audienceCount,
  brand,
  currentUserEmail,
}: {
  campaign: CampaignMeta;
  initialBody: CampaignBody;
  labels: Label[];
  identities: Identity[];
  audienceCount: number;
  brand: EffectiveBrand;
  currentUserEmail: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [subject, setSubject] = useState(campaign.subject);
  const [previewText, setPreviewText] = useState(campaign.preview_text);
  const [labelIds, setLabelIds] = useState<string[]>(campaign.label_ids);
  const [identityId, setIdentityId] = useState(campaign.sending_identity_id ?? "");
  const [body, setBody] = useState<CampaignBody>(initialBody);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "done">("idle");
  const [sendProgress, setSendProgress] = useState({ sent: 0, failed: 0 });
  const [testEmail, setTestEmail] = useState(currentUserEmail ?? "");
  const [testState, setTestState] = useState<"idle" | "sending" | "done">("idle");

  const sent = campaign.status === "sent" || campaign.status === "sending";

  const labelById = useMemo(() => {
    const map = new Map<string, Label>();
    for (const l of labels) map.set(l.id, l);
    return map;
  }, [labels]);

  const selectedLabels = labelIds
    .map((id) => labelById.get(id))
    .filter((l): l is Label => !!l);

  const availableLabels = labels.filter((l) => !labelIds.includes(l.id));

  const labelSetChanged = useMemo(() => {
    if (labelIds.length !== campaign.label_ids.length) return true;
    const saved = new Set(campaign.label_ids);
    return labelIds.some((id) => !saved.has(id));
  }, [labelIds, campaign.label_ids]);

  function addLabel(id: string) {
    if (!id || labelIds.includes(id)) return;
    setLabelIds((ids) => [...ids, id]);
  }
  function removeLabel(id: string) {
    setLabelIds((ids) => ids.filter((x) => x !== id));
  }

  const previewHtml = useMemo(
    () => renderCampaignHtml(body, { previewText, brand }),
    [body, previewText, brand]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBody((b) => {
      const oldIdx = b.blocks.findIndex((bl) => bl.id === active.id);
      const newIdx = b.blocks.findIndex((bl) => bl.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return b;
      return { ...b, blocks: arrayMove(b.blocks, oldIdx, newIdx) };
    });
  }

  function newBlock(type: CampaignBlockType): CampaignBlock {
    switch (type) {
      case "heading":
        return { id: newBlockId(), type, text: "A confident headline" };
      case "text":
        return {
          id: newBlockId(),
          type,
          text: "Write your message — bold, italics, and links supported.",
        };
      case "button":
        return {
          id: newBlockId(),
          type,
          text: "Learn more",
          url: "https://",
          style: "filled",
        };
      case "image":
        return { id: newBlockId(), type, url: "", alt: "" };
      case "divider":
        return { id: newBlockId(), type, style: "rule" };
      case "eyebrow":
        return { id: newBlockId(), type, text: "FROM THE FIELD" };
      case "quote":
        return {
          id: newBlockId(),
          type,
          text: "A short, vivid sentence worth quoting.",
          attribution: "",
        };
      case "spacer":
        return { id: newBlockId(), type, size: "md" };
      case "image-text":
        return {
          id: newBlockId(),
          type,
          url: "",
          alt: "",
          heading: "Section title",
          text: "A few sentences of body copy sit beside the image.",
          layout: "image-left",
        };
      case "cta":
        return {
          id: newBlockId(),
          type,
          heading: "Take the next step",
          text: "One clear sentence about why this matters.",
          buttonText: "Get involved",
          buttonUrl: "https://",
        };
    }
  }
  function addBlock(type: CampaignBlockType) {
    setBody((b) => ({ ...b, blocks: [...b.blocks, newBlock(type)] }));
  }
  function updateBlock(id: string, patch: Partial<CampaignBlock>) {
    setBody((b) => ({
      ...b,
      blocks: b.blocks.map((bl) =>
        bl.id === id ? ({ ...bl, ...patch } as CampaignBlock) : bl
      ),
    }));
  }
  function removeBlock(id: string) {
    setBody((b) => ({ ...b, blocks: b.blocks.filter((bl) => bl.id !== id) }));
  }
  function moveBlock(idx: number, dir: -1 | 1) {
    setBody((b) => {
      const next = [...b.blocks];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return b;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...b, blocks: next };
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        subject,
        preview_text: previewText,
        body_source: body,
        label_ids: labelIds,
        sending_identity_id: identityId || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to save");
      return;
    }
    setMsg("Saved");
    router.refresh();
  }

  async function persist(): Promise<boolean> {
    const res = await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        subject,
        preview_text: previewText,
        body_source: body,
        label_ids: labelIds,
        sending_identity_id: identityId || undefined,
      }),
    });
    return res.ok;
  }

  function preflightError(): string | null {
    if (!subject.trim()) return "Add a subject line before sending.";
    if (labelIds.length === 0) return "Pick at least one audience label.";
    if (!identityId) return "Pick a sending identity.";
    if (body.blocks.length === 0) return "Add at least one content block.";
    return null;
  }

  async function sendTest() {
    setErr(null);
    setMsg(null);
    if (!testEmail.trim()) return setErr("Enter an email address.");
    if (body.blocks.length === 0)
      return setErr("Add at least one content block before sending a test.");
    if (!subject.trim()) return setErr("Add a subject before sending a test.");
    if (!identityId) return setErr("Pick a sending identity first.");

    // Persist so the test renders the latest content.
    if (!(await persist()))
      return setErr("Could not save the campaign before sending the test.");

    setTestState("sending");
    const res = await fetch(`/api/campaigns/${campaign.id}/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: testEmail.trim() }),
    });
    setTestState("idle");
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      return setErr(d.error ?? "Test send failed");
    }
    setTestState("done");
    setMsg(`Test sent to ${testEmail.trim()}.`);
  }

  // ────────────────────────────────────────────────────────────
  // AI: suggest layout
  // ────────────────────────────────────────────────────────────
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<CampaignBody | null>(null);
  const [suggestionWarnings, setSuggestionWarnings] = useState<string[]>([]);

  async function requestLayoutSuggestion() {
    if (body.blocks.length === 0) {
      setErr("Add at least one content block before asking for a suggestion.");
      return;
    }
    setErr(null);
    setMsg(null);
    setSuggesting(true);
    try {
      const res = await fetch(
        `/api/campaigns/${campaign.id}/ai/suggest-layout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        }
      );
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(d.error ?? "Suggestion failed");
        return;
      }
      const data = (await res.json()) as {
        body: CampaignBody;
        warnings: string[];
      };
      setSuggestion(data.body);
      setSuggestionWarnings(data.warnings ?? []);
    } finally {
      setSuggesting(false);
    }
  }

  function acceptSuggestion() {
    if (!suggestion) return;
    setBody(suggestion);
    setSuggestion(null);
    setSuggestionWarnings([]);
    setMsg("Applied AI layout. Save to keep the changes.");
  }

  function rejectSuggestion() {
    setSuggestion(null);
    setSuggestionWarnings([]);
  }

  function applyTemplate(templateId: string) {
    if (!templateId) return;
    const tpl = getCampaignTemplate(templateId);
    if (!tpl) return;
    if (
      body.blocks.length > 0 &&
      !confirm(
        `Apply "${tpl.name}" template? This will replace all current blocks. Subject and audience are not changed.`
      )
    ) {
      return;
    }
    setBody(tpl.build(newBlockId));
    setMsg(`Applied template: ${tpl.name}. Save to keep the changes.`);
  }

  async function sendNow() {
    const pf = preflightError();
    if (pf) return setErr(pf);
    if (
      !confirm(
        `Send "${name}" to ${audienceCount} contact${
          audienceCount === 1 ? "" : "s"
        } now?`
      )
    )
      return;

    setErr(null);
    setMsg(null);
    if (!(await persist())) return setErr("Could not save the campaign.");

    setSendState("sending");
    let totalSent = 0;
    let totalFailed = 0;
    for (let i = 0; i < 1000; i++) {
      const res = await fetch(`/api/campaigns/${campaign.id}/send`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(data.error ?? "Send failed");
        setSendState("idle");
        return;
      }
      const r = (await res.json()) as {
        sent: number;
        failed: number;
        done: boolean;
      };
      totalSent += r.sent;
      totalFailed += r.failed;
      setSendProgress({ sent: totalSent, failed: totalFailed });
      if (r.done) break;
    }
    setSendState("done");
    router.refresh();
  }

  async function schedule() {
    const pf = preflightError();
    if (pf) return setErr(pf);
    if (!scheduleAt) return setErr("Pick a date and time.");
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) {
      return setErr("Pick a future date and time.");
    }
    setErr(null);
    setBusy(true);
    if (!(await persist())) {
      setBusy(false);
      return setErr("Could not save the campaign.");
    }
    const res = await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "scheduled",
        scheduled_at: when.toISOString(),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return setErr(data.error ?? "Could not schedule");
    }
    setMsg(`Scheduled for ${when.toLocaleString()}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={sent}
          className="flex-1 text-base font-semibold"
        />
        <div className="flex items-center gap-2">
          {!sent && (
            <Button
              variant="outline"
              size="sm"
              onClick={requestLayoutSuggestion}
              disabled={suggesting || busy}
              className="gap-1.5 h-7 text-xs"
              title="Ask AI for a stronger editorial layout"
            >
              <Sparkles
                className={`h-3 w-3 ${suggesting ? "animate-pulse text-amber-400" : ""}`}
              />
              {suggesting ? "Thinking…" : "AI layout"}
            </Button>
          )}
          {!sent && (
            <select
              value=""
              onChange={(e) => {
                applyTemplate(e.target.value);
                e.target.value = "";
              }}
              className="text-xs border rounded px-2 py-1 bg-background"
              title="Apply an editorial template"
            >
              <option value="">Apply template…</option>
              {CAMPAIGN_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <span
            className={`text-xs px-2 py-0.5 rounded-full capitalize ${
              STATUS_CLASS[campaign.status] ?? "status-grey"
            }`}
          >
            {campaign.status}
          </span>
          {!sent && (
            <Button
              variant="outline"
              size="sm"
              onClick={save}
              disabled={busy}
            >
              Save draft
            </Button>
          )}
        </div>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      {msg && <p className="text-sm text-emerald-400">{msg}</p>}
      {sent && (
        <p className="text-sm text-amber-400">
          This campaign has been sent and can no longer be edited.
        </p>
      )}

      {suggestion && (
        <SuggestionPreview
          current={body}
          proposed={suggestion}
          warnings={suggestionWarnings}
          onAccept={acceptSuggestion}
          onReject={rejectSuggestion}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Editor */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Subject line">
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={sent}
                  placeholder="What recipients see in their inbox"
                />
              </Field>
              <Field label="Preview text">
                <Input
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  disabled={sent}
                  placeholder="The grey text shown after the subject"
                />
              </Field>

              <Field label="Audience labels (anyone with ANY of these receives the send)">
                <div className="space-y-2">
                  {selectedLabels.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No labels selected — pick one or more below.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLabels.map((l) => (
                        <span
                          key={l.id}
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-muted"
                        >
                          {l.name}
                          {!sent && (
                            <button
                              type="button"
                              onClick={() => removeLabel(l.id)}
                              className="hover:text-red-400"
                              aria-label={`Remove ${l.name}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {!sent && availableLabels.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        addLabel(e.target.value);
                        e.target.value = "";
                      }}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">+ Add a label…</option>
                      {availableLabels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </Field>

              <Field label="Send from">
                <select
                  value={identityId}
                  onChange={(e) => setIdentityId(e.target.value)}
                  disabled={sent}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  <option value="">— pick —</option>
                  {identities.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.display_name}
                    </option>
                  ))}
                </select>
              </Field>

              <p className="text-xs text-muted-foreground">
                Current audience:{" "}
                <span className="font-medium">{audienceCount}</span> contact
                {audienceCount === 1 ? "" : "s"} (subscribed, not unsubscribed or
                bounced).
                {labelSetChanged && (
                  <span className="text-amber-400 ml-1">
                    Save to recompute after changing labels.
                  </span>
                )}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Content blocks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {body.blocks.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  No blocks — add one below.
                </p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={body.blocks.map((b) => b.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {body.blocks.map((block, idx) => (
                    <SortableBlockEditor
                      key={block.id}
                      block={block}
                      disabled={sent}
                      campaignId={campaign.id}
                      onChange={(patch) => updateBlock(block.id, patch)}
                      onRemove={() => removeBlock(block.id)}
                      onUp={() => moveBlock(idx, -1)}
                      onDown={() => moveBlock(idx, 1)}
                      canUp={idx > 0}
                      canDown={idx < body.blocks.length - 1}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {!sent && (
                <div className="pt-2 space-y-2 border-t mt-3">
                  {ADD_GROUPS.map((g) => (
                    <div key={g.group} className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold w-14">
                        {g.group}
                      </span>
                      {g.items.map((t) => (
                        <Button
                          key={t.type}
                          variant="outline"
                          size="sm"
                          onClick={() => addBlock(t.type)}
                          className="gap-1 h-7 text-xs"
                        >
                          <Plus className="h-3 w-3" />
                          {t.label}
                        </Button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live preview */}
        <Card className="lg:sticky lg:top-4 self-start">
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <iframe
              title="Email preview"
              srcDoc={previewHtml}
              className="w-full rounded border"
              style={{ height: 520, background: "#fff" }}
            />
          </CardContent>
        </Card>
      </div>

      {/* Send */}
      {!sent && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Test send — always available, even before audience is locked. */}
            <div className="flex flex-wrap items-end gap-2 pb-3 border-b">
              <label className="block">
                <span className="block text-muted-foreground mb-1 text-xs">
                  Test send to
                </span>
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-56"
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={sendTest}
                disabled={busy || testState === "sending"}
              >
                {testState === "sending" ? "Sending…" : "Send test"}
              </Button>
              <p className="text-xs text-muted-foreground basis-full">
                Sends the current draft with subject prefixed{" "}
                <span className="font-mono">[TEST]</span>. Doesn&apos;t affect
                campaign status or analytics.
              </p>
            </div>

            {sendState === "sending" && (
              <p className="text-sm text-sky-400">
                Sending… {sendProgress.sent} sent
                {sendProgress.failed > 0 ? `, ${sendProgress.failed} failed` : ""}
              </p>
            )}
            {sendState === "done" && (
              <p className="text-sm text-emerald-400">
                ✓ Campaign sent — {sendProgress.sent} delivered to the provider
                {sendProgress.failed > 0 ? `, ${sendProgress.failed} failed` : ""}.
              </p>
            )}
            {sendState === "idle" && (
              <div className="flex flex-wrap items-end gap-4">
                <Button onClick={sendNow} disabled={busy}>
                  Send now to {audienceCount}
                </Button>
                <span className="text-sm text-muted-foreground">or</span>
                <div className="flex items-end gap-2">
                  <label className="block">
                    <span className="block text-muted-foreground mb-1 text-xs">
                      Schedule for
                    </span>
                    <Input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      className="w-auto"
                    />
                  </label>
                  <Button variant="outline" onClick={schedule} disabled={busy}>
                    Schedule
                  </Button>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Recipients are deduplicated across the chosen labels and exclude
              anyone unsubscribed, bounced, or not subscribed. Every email
              includes a Manage Preferences link.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-muted-foreground mb-1 text-xs">{label}</span>
      {children}
    </label>
  );
}

type BlockEditorProps = {
  block: CampaignBlock;
  disabled: boolean;
  campaignId: string;
  onChange: (patch: Partial<CampaignBlock>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  canUp: boolean;
  canDown: boolean;
};

function SortableBlockEditor(props: BlockEditorProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.block.id, disabled: props.disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <BlockEditor
        {...props}
        dragHandleProps={{ attributes, listeners }}
      />
    </div>
  );
}

function BlockEditor({
  block,
  disabled,
  campaignId,
  onChange,
  onRemove,
  onUp,
  onDown,
  canUp,
  canDown,
  dragHandleProps,
}: BlockEditorProps & {
  dragHandleProps?: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
  };
}) {
  return (
    <div className="rounded-lg border bg-muted/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {dragHandleProps && (
            <button
              type="button"
              {...dragHandleProps.attributes}
              {...dragHandleProps.listeners}
              disabled={disabled}
              className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Drag to reorder"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            {block.type}
          </span>
        </div>
        <div className="flex gap-1">
          <Mini onClick={onUp} disabled={disabled || !canUp} label="↑" />
          <Mini onClick={onDown} disabled={disabled || !canDown} label="↓" />
          <Mini onClick={onRemove} disabled={disabled} label="✕" danger />
        </div>
      </div>
      {block.type === "heading" && (
        <>
          <Input
            value={block.eyebrow ?? ""}
            onChange={(e) =>
              onChange({ eyebrow: e.target.value || undefined })
            }
            disabled={disabled}
            placeholder="Eyebrow (optional, small uppercase label above)"
            className="text-xs"
          />
          <Input
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
            disabled={disabled}
            placeholder="Headline"
            className="text-sm font-medium"
          />
        </>
      )}
      {block.type === "text" && (
        <>
          <RichText
            value={block.text}
            onChange={(html) => onChange({ text: html })}
            disabled={disabled}
            placeholder="Write your message — bold, italics, and links supported."
            mergeFields={[{ label: "First name", token: "[First Name]" }]}
            onPolish={async (html) => {
              const res = await fetch(
                `/api/campaigns/${campaignId}/ai/polish`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ html }),
                }
              );
              if (!res.ok) {
                const d = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                throw new Error(d.error ?? "Polish failed");
              }
              const data = (await res.json()) as { polished: string };
              return data.polished;
            }}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
            <input
              type="checkbox"
              checked={!!block.dropCap}
              onChange={(e) =>
                onChange({ dropCap: e.target.checked || undefined })
              }
              disabled={disabled}
              className="rounded"
            />
            Drop cap on first letter (editorial accent)
          </label>
        </>
      )}
      {block.type === "button" && (
        <>
          <Input
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
            disabled={disabled}
            placeholder="Button label"
          />
          <Input
            value={block.url}
            onChange={(e) => onChange({ url: e.target.value })}
            disabled={disabled}
            placeholder="https://…"
          />
          <SegmentedPicker
            label="Style"
            value={block.style ?? "filled"}
            disabled={disabled}
            options={[
              { value: "filled", label: "Filled" },
              { value: "outline", label: "Outline" },
              { value: "link", label: "Text link" },
            ]}
            onChange={(v) => onChange({ style: v as ButtonStyle })}
          />
        </>
      )}
      {block.type === "image" && (
        <ImageBlockFields
          block={block}
          disabled={disabled}
          campaignId={campaignId}
          onChange={onChange}
        />
      )}
      {block.type === "divider" && (
        <SegmentedPicker
          label="Style"
          value={block.style ?? "rule"}
          disabled={disabled}
          options={[
            { value: "rule", label: "Rule" },
            { value: "dots", label: "Dots" },
            { value: "space", label: "Space only" },
          ]}
          onChange={(v) => onChange({ style: v as DividerStyle })}
        />
      )}
      {block.type === "eyebrow" && (
        <Input
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          disabled={disabled}
          placeholder="EYEBROW LABEL"
          className="uppercase tracking-wider text-xs"
        />
      )}
      {block.type === "quote" && (
        <>
          <textarea
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
            disabled={disabled}
            placeholder="A short, vivid sentence worth quoting."
            rows={2}
            className="w-full rounded border bg-background px-2 py-1.5 text-sm italic resize-none"
          />
          <Input
            value={block.attribution ?? ""}
            onChange={(e) =>
              onChange({ attribution: e.target.value || undefined })
            }
            disabled={disabled}
            placeholder="Attribution (optional, e.g. 'Team leader')"
            className="text-xs"
          />
        </>
      )}
      {block.type === "spacer" && (
        <SegmentedPicker
          label="Size"
          value={block.size ?? "md"}
          disabled={disabled}
          options={[
            { value: "sm", label: "S · 16" },
            { value: "md", label: "M · 32" },
            { value: "lg", label: "L · 56" },
            { value: "xl", label: "XL · 96" },
          ]}
          onChange={(v) => onChange({ size: v as SpacerSize })}
        />
      )}
      {block.type === "image-text" && (
        <ImageTextFields
          block={block}
          disabled={disabled}
          campaignId={campaignId}
          onChange={onChange}
        />
      )}
      {block.type === "cta" && (
        <>
          <Input
            value={block.heading}
            onChange={(e) => onChange({ heading: e.target.value })}
            disabled={disabled}
            placeholder="Heading"
            className="text-sm font-medium"
          />
          <textarea
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
            disabled={disabled}
            placeholder="One clear sentence about why this matters."
            rows={2}
            className="w-full rounded border bg-background px-2 py-1.5 text-sm resize-none"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              value={block.buttonText}
              onChange={(e) => onChange({ buttonText: e.target.value })}
              disabled={disabled}
              placeholder="Button label"
            />
            <Input
              value={block.buttonUrl}
              onChange={(e) => onChange({ buttonUrl: e.target.value })}
              disabled={disabled}
              placeholder="https://…"
            />
          </div>
        </>
      )}
    </div>
  );
}

function SegmentedPicker<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
      )}
      <div className="inline-flex rounded border overflow-hidden">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              disabled={disabled}
              className={`px-2 py-1 text-[11px] border-r last:border-r-0 transition-colors disabled:opacity-30 ${
                active
                  ? "bg-foreground text-background"
                  : "bg-background hover:bg-muted text-muted-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Extract just the filename from an upload URL, falling back to a truncated path. */
function filenameFromUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    // Storage paths often start with a timestamp like "1779776086052-7hka2j.jpg".
    // Strip the leading "<digits>-" so the display is friendlier.
    return last.replace(/^\d+-/, "") || url;
  } catch {
    return url;
  }
}

function ImageBlockFields({
  block,
  disabled,
  campaignId,
  onChange,
}: {
  block: Extract<CampaignBlock, { type: "image" }>;
  disabled: boolean;
  campaignId: string;
  onChange: (patch: Partial<CampaignBlock>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/campaigns/${campaignId}/image`, {
      method: "POST",
      body: fd,
    });
    setUploading(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(d.error ?? "Upload failed");
      return;
    }
    const data = (await res.json()) as { url: string };
    onChange({ url: data.url });
  }

  return (
    <div className="space-y-2">
      {block.url && /^https?:\/\//i.test(block.url) ? (
        <div className="flex items-start gap-3 p-2 border rounded bg-background">
          <img
            src={block.url}
            alt={block.alt || "Preview"}
            className="h-20 w-auto max-w-[160px] object-cover rounded"
          />
          <div className="flex-1 min-w-0 space-y-1.5 text-xs">
            <p
              className="text-muted-foreground truncate"
              title={block.url}
            >
              {filenameFromUrl(block.url)}
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || uploading}
                onClick={() => inputRef.current?.click()}
                className="h-6 px-2 text-[11px]"
              >
                Replace
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onChange({ url: "" })}
                className="h-6 px-2 text-[11px] text-red-400"
              >
                Clear
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="w-full gap-1.5"
        >
          {uploading ? "Uploading…" : "Upload image"}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
          or paste a URL
        </summary>
        <Input
          value={block.url}
          onChange={(e) => onChange({ url: e.target.value })}
          disabled={disabled}
          placeholder="https://…"
          className="mt-1.5"
        />
      </details>
      <Input
        value={block.alt}
        onChange={(e) => onChange({ alt: e.target.value })}
        disabled={disabled}
        placeholder="Alt text (describe the image for screen readers)"
        className="text-xs"
      />
      <Input
        value={block.caption ?? ""}
        onChange={(e) =>
          onChange({ caption: e.target.value || undefined })
        }
        disabled={disabled}
        placeholder="Caption (optional italic line below image)"
        className="text-xs"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
        <input
          type="checkbox"
          checked={!!block.fullBleed}
          onChange={(e) =>
            onChange({ fullBleed: e.target.checked || undefined })
          }
          disabled={disabled}
          className="rounded"
        />
        Full-bleed (edge-to-edge in the email card)
      </label>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}

function ImageTextFields({
  block,
  disabled,
  campaignId,
  onChange,
}: {
  block: Extract<CampaignBlock, { type: "image-text" }>;
  disabled: boolean;
  campaignId: string;
  onChange: (patch: Partial<CampaignBlock>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/campaigns/${campaignId}/image`, {
      method: "POST",
      body: fd,
    });
    setUploading(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(d.error ?? "Upload failed");
      return;
    }
    const data = (await res.json()) as { url: string };
    onChange({ url: data.url });
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          {block.url && /^https?:\/\//i.test(block.url) ? (
            <div className="relative">
              <img
                src={block.url}
                alt={block.alt || "Preview"}
                className="w-full h-24 object-cover rounded border"
              />
              <button
                type="button"
                onClick={() => onChange({ url: "" })}
                disabled={disabled}
                className="absolute top-1 right-1 bg-background/90 rounded h-5 w-5 text-[10px] text-red-400 border"
                aria-label="Clear image"
              >
                ×
              </button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
              className="w-full h-24 text-xs"
            >
              {uploading ? "Uploading…" : "Upload image"}
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          <Input
            value={block.alt}
            onChange={(e) => onChange({ alt: e.target.value })}
            disabled={disabled}
            placeholder="Alt text"
            className="text-xs mt-1.5"
          />
        </div>
        <div className="space-y-1.5">
          <Input
            value={block.heading ?? ""}
            onChange={(e) =>
              onChange({ heading: e.target.value || undefined })
            }
            disabled={disabled}
            placeholder="Section title (optional)"
            className="text-xs"
          />
          <textarea
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
            disabled={disabled}
            placeholder="Body copy beside the image"
            rows={4}
            className="w-full rounded border bg-background px-2 py-1.5 text-xs resize-none"
          />
        </div>
      </div>
      <SegmentedPicker
        label="Layout"
        value={block.layout ?? "image-left"}
        disabled={disabled}
        options={[
          { value: "image-left", label: "Image · Text" },
          { value: "image-right", label: "Text · Image" },
        ]}
        onChange={(v) =>
          onChange({ layout: v as "image-left" | "image-right" })
        }
      />
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}

function Mini({
  onClick,
  disabled,
  label,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-5 h-5 text-[11px] rounded border disabled:opacity-30 ${
        danger
          ? "text-red-400 hover:bg-red-500/10 hover:border-red-500/30"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// AI layout suggestion preview
// ────────────────────────────────────────────────────────────

function SuggestionPreview({
  current,
  proposed,
  warnings,
  onAccept,
  onReject,
}: {
  current: CampaignBody;
  proposed: CampaignBody;
  warnings: string[];
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <Card className="border-amber-400/30 bg-amber-400/5">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-amber-400" />
            AI layout suggestion
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Review the proposed structure. Apply replaces all current blocks
            (save to keep).
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Button variant="ghost" size="sm" onClick={onReject}>
            Discard
          </Button>
          <Button size="sm" onClick={onAccept} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Apply layout
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <BlockSummaryList title={`Current (${current.blocks.length})`} blocks={current.blocks} muted />
          <BlockSummaryList title={`Proposed (${proposed.blocks.length})`} blocks={proposed.blocks} />
        </div>
        {warnings.length > 0 && (
          <p className="text-xs text-amber-400 mt-3">
            {warnings.length} block{warnings.length === 1 ? "" : "s"} skipped:{" "}
            {warnings.join("; ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BlockSummaryList({
  title,
  blocks,
  muted,
}: {
  title: string;
  blocks: CampaignBlock[];
  muted?: boolean;
}) {
  return (
    <div className={`space-y-1 ${muted ? "opacity-60" : ""}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
        {title}
      </p>
      <ol className="space-y-1">
        {blocks.map((b, i) => (
          <li
            key={b.id}
            className="text-xs flex items-start gap-2 rounded border bg-background/60 px-2 py-1.5"
          >
            <span className="text-[10px] text-muted-foreground tabular-nums w-5 pt-0.5">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex-1 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {b.type}
              </span>
              <span className="block truncate text-foreground">
                {blockOneLine(b)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function blockOneLine(b: CampaignBlock): string {
  switch (b.type) {
    case "eyebrow":
      return b.text;
    case "heading":
      return (b.eyebrow ? `${b.eyebrow} · ` : "") + b.text;
    case "text": {
      const stripped = b.text.replace(/<[^>]+>/g, "").trim();
      return stripped.length > 100 ? stripped.slice(0, 100) + "…" : stripped;
    }
    case "button":
      return `${b.text} → ${b.url}`;
    case "image":
      return b.caption || b.alt || b.url || "(empty image)";
    case "divider":
      return `${b.style ?? "rule"} divider`;
    case "quote":
      return `“${b.text}”${b.attribution ? ` — ${b.attribution}` : ""}`;
    case "spacer":
      return `${b.size ?? "md"} space`;
    case "image-text":
      return `${b.heading ? b.heading + " · " : ""}${(b.text || "").replace(/<[^>]+>/g, "").slice(0, 80)}`;
    case "cta":
      return `${b.heading} → ${b.buttonText}`;
  }
}
