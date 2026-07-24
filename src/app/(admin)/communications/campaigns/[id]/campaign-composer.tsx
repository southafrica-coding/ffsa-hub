"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, GripVertical, Sparkles } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
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
  type BlockStyle,
  type BlockAlign,
  type BlockFontFamily,
  type BlockFontWeight,
  type ColumnCell,
  type SectionLayout,
  type EmailDesign,
  COLUMN_ALLOWED_TYPES,
  FONT_CATALOG,
  editorWebFontsHref,
  resolveTheme,
  renderBlock,
  sectionColumnWeights,
  newBlockId,
} from "@/lib/campaigns/blocks";
import type { SocialLink } from "@/services/brand";
import {
  findLocation,
  getContainer,
  insertAt,
  removeById,
  moveBlock as treeMoveBlock,
  updateBlockById,
  newSection,
  newColumn,
  type ContainerId,
} from "@/lib/campaigns/tree";
import {
  CAMPAIGN_TEMPLATES,
  getCampaignTemplate,
} from "@/lib/campaigns/templates";
import type { EffectiveBrand } from "@/services/brand";
import { RichText } from "@/components/communications/rich-text";
import { ImageCropDialog } from "@/components/communications/image-crop-dialog";
import { EmailCanvas } from "./canvas/EmailCanvas";

type Label = { id: string; slug: string; name: string };
type Identity = { id: string; display_name: string; from_email: string };
type CustomTemplate = {
  id: string;
  name: string;
  tagline: string | null;
  body_source: CampaignBody;
};

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
      { type: "social", label: "Social links" },
    ],
  },
];

// Column-section layout presets for the "Sections" palette tab.
const SECTION_PRESETS: { layout: SectionLayout; label: string }[] = [
  { layout: "1-1", label: "2 columns" },
  { layout: "1-1-1", label: "3 columns" },
  { layout: "1-1-1-1", label: "4 columns" },
  { layout: "1-2", label: "1 : 2" },
  { layout: "2-1", label: "2 : 1" },
];

const STATUS_CLASS: Record<string, string> = {
  draft: "status-grey",
  scheduled: "status-yellow",
  sending: "status-yellow",
  sent: "status-green",
  failed: "status-red",
  cancelled: "status-grey",
};

// Regenerate all block ids (including nested section columns + their children)
// so an applied template's blocks are unique within this email.
function reidBlocks(blocks: CampaignBlock[]): CampaignBlock[] {
  return blocks.map((b) =>
    b.type === "section"
      ? {
          ...b,
          id: newBlockId(),
          columns: b.columns.map((c) => ({
            ...c,
            id: newBlockId(),
            blocks: reidBlocks(c.blocks),
          })),
        }
      : { ...b, id: newBlockId() }
  );
}

// Echo a scheduled time explicitly in South Africa Standard Time, regardless
// of the admin's browser timezone, so a mis-set laptop clock is caught.
function formatSast(when: Date): string {
  return `${when.toLocaleString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  })} SAST`;
}

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
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [paletteTab, setPaletteTab] = useState<"modules" | "sections">("modules");
  const [designOpen, setDesignOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);

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

  // Selection can live at the root or inside a section column.
  const selLoc = selectedBlockId ? findLocation(body, selectedBlockId) : null;
  const selectedContainer: ContainerId = selLoc?.container ?? "root";
  const selectedIdx = selLoc?.index ?? -1;
  const selectedBlock = selLoc
    ? getContainer(body, selLoc.container)[selLoc.index] ?? null
    : null;
  const selectedContainerLen = getContainer(body, selectedContainer).length;

  // Mouse drags start after a small deliberate move (so a click still selects);
  // touch drags need a short press-and-hold so scrolling the page still works.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 160, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const previewTheme = useMemo(
    () => resolveTheme(brand, body.design),
    [brand, body.design]
  );

  const [activeDrag, setActiveDrag] = useState<
    { kind: "palette"; label: string } | { kind: "block"; blockId: string } | null
  >(null);

  function handleDragStart(event: DragStartEvent) {
    const d = event.active.data.current as
      | { kind?: string; blockType?: string }
      | undefined;
    if (d?.kind === "palette") {
      setActiveDrag({
        kind: "palette",
        label: d.blockType === "section" ? "section" : d.blockType ?? "block",
      });
    } else {
      setActiveDrag({ kind: "block", blockId: String(event.active.id) });
    }
  }

  // Resolve the drop destination (container + insertion index) from `over`.
  function dropTarget(
    over: DragEndEvent["over"]
  ): { container: ContainerId; index: number } | null {
    if (!over) return null;
    const d = over.data.current as
      | { kind?: string; container?: ContainerId; index?: number }
      | undefined;
    if (d?.kind === "dropzone" && d.container != null && d.index != null) {
      return { container: d.container, index: d.index };
    }
    // Dropped over a block → insert before it, within its container.
    const l = findLocation(body, String(over.id));
    if (l) return { container: l.container, index: l.index };
    return null;
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    const target = dropTarget(over);
    if (!target) return;
    const data = active.data.current as
      | { kind?: string; blockType?: CampaignBlockType; layout?: SectionLayout }
      | undefined;

    if (data?.kind === "palette" && data.blockType) {
      const blk =
        data.blockType === "section"
          ? newSection(data.layout ?? "1-1")
          : newBlock(data.blockType);
      // Only leaf blocks may go inside a column (sections never nest).
      if (target.container !== "root" && !COLUMN_ALLOWED_TYPES.has(blk.type))
        return;
      setBody((b) => insertAt(b, target.container, target.index, blk));
      selectBlock(blk.id);
      return;
    }
    // Reorder an existing block (tree.moveBlock guards bad targets + nesting).
    const id = String(active.id);
    setBody((b) => treeMoveBlock(b, id, target.container, target.index));
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
      case "columns":
        return {
          id: newBlockId(),
          type,
          cells: [
            { heading: "", text: "First column — a short paragraph." },
            { heading: "", text: "Second column — another short paragraph." },
          ],
        };
      case "social":
        // No links => renderer falls back to the brand kit's social links.
        return { id: newBlockId(), type };
      case "section":
        // Minimal default; the palette (next PR) offers layout presets.
        return {
          id: newBlockId(),
          type,
          layout: "1-1",
          columns: [
            { id: newBlockId(), blocks: [] },
            { id: newBlockId(), blocks: [] },
          ],
        };
    }
  }
  // Select a block and leave the global Design panel.
  function selectBlock(id: string | null) {
    setSelectedBlockId(id);
    if (id) setDesignOpen(false);
  }
  function addBlock(type: CampaignBlockType) {
    const blk = newBlock(type);
    setBody((b) => insertAt(b, "root", b.blocks.length, blk));
    selectBlock(blk.id);
  }
  function addSection(layout: SectionLayout) {
    const sec = newSection(layout);
    setBody((b) => insertAt(b, "root", b.blocks.length, sec));
    selectBlock(sec.id);
  }
  // Change a section's layout, reconciling the column count (keep existing
  // column content where possible; add empty / drop extra columns).
  function setSectionLayout(id: string, layout: SectionLayout) {
    const l = findLocation(body, id);
    if (!l) return;
    const sec = getContainer(body, l.container)[l.index];
    if (!sec || sec.type !== "section") return;
    const want = sectionColumnWeights(layout).length;
    const cols = [...sec.columns];
    while (cols.length < want) cols.push(newColumn());
    if (cols.length > want) cols.length = want;
    updateBlock(id, { layout, columns: cols });
  }
  function updateDesign(patch: Partial<EmailDesign>) {
    setBody((b) => ({ ...b, design: { ...b.design, ...patch } }));
  }
  function updateBlock(id: string, patch: Partial<CampaignBlock>) {
    setBody((b) => updateBlockById(b, id, patch));
  }
  function removeBlock(id: string) {
    setBody((b) => removeById(b, id));
    setSelectedBlockId((cur) => (cur === id ? null : cur));
  }
  function duplicateBlock(id: string) {
    const l = findLocation(body, id);
    if (!l) return;
    const src = getContainer(body, l.container)[l.index];
    if (!src) return;
    const copy = reidBlocks([src])[0];
    setBody((b) => insertAt(b, l.container, l.index + 1, copy));
    setSelectedBlockId(copy.id);
  }
  // Move a block one step within its own container (inspector ↑/↓ buttons).
  function nudgeBlock(id: string, dir: -1 | 1) {
    const l = findLocation(body, id);
    if (!l) return;
    // destIndex is an insertion index; +2 lands one slot down, −1 one slot up.
    const dest = dir === -1 ? l.index - 1 : l.index + 2;
    setBody((b) => treeMoveBlock(b, id, l.container, dest));
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
      return setErr("Could not save the email before sending the test.");

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
    // The AI rewrite is section-unaware and would flatten column layouts.
    if (
      body.blocks.some((b) => b.type === "section") &&
      !confirm(
        "AI layout rebuilds the blocks and will remove your column sections. Continue?"
      )
    ) {
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
    const s = suggestion;
    // Preserve per-email design overrides — the AI rewrites blocks, not design.
    setBody((b) => ({ ...s, design: b.design }));
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
    const built = tpl.build(newBlockId);
    setBody((b) => ({ ...built, design: b.design }));
    setTemplatesOpen(false);
    setMsg(`Applied template: ${tpl.name}. Save to keep the changes.`);
  }

  // Load the curated webfonts once so the live canvas preview matches whatever
  // font the user picks (the sent email loads them via its own <link>).
  useEffect(() => {
    const id = "composer-webfonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = editorWebFontsHref();
    document.head.appendChild(link);
  }, []);

  // Load saved custom templates for the gallery.
  useEffect(() => {
    let alive = true;
    fetch("/api/email-templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: CustomTemplate[] }) => {
        if (alive) setCustomTemplates(d.templates ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function applyCustomTemplate(t: CustomTemplate) {
    if (
      body.blocks.length > 0 &&
      !confirm(`Apply "${t.name}"? This replaces all current blocks.`)
    ) {
      return;
    }
    // Fresh block ids (incl. nested section columns/children) so they're unique.
    const blocks = reidBlocks(t.body_source.blocks ?? []);
    setBody((b) => ({ version: 1, blocks, design: b.design }));
    setTemplatesOpen(false);
    setMsg(`Applied template: ${t.name}. Save to keep the changes.`);
  }

  async function saveAsTemplate() {
    const name = prompt("Name this template:");
    if (!name || !name.trim()) return;
    setErr(null);
    const res = await fetch("/api/email-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), body_source: body }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      return setErr(d.error ?? "Could not save template");
    }
    const { template } = (await res.json()) as { template: CustomTemplate };
    setCustomTemplates((cur) => [template, ...cur]);
    setMsg(`Saved “${name.trim()}” to your templates.`);
  }

  async function deleteCustomTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    const res = await fetch(`/api/email-templates/${id}`, { method: "DELETE" });
    if (res.ok) setCustomTemplates((cur) => cur.filter((t) => t.id !== id));
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
    if (!(await persist())) return setErr("Could not save the email.");

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
      return setErr("Could not save the email.");
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
    setMsg(`Scheduled to send ${formatSast(when)}.`);
    router.refresh();
  }

  // Clone a sent email into a fresh editable draft (same design, audience,
  // and sender). The user can then tweak it and/or add more audience labels
  // before sending again.
  async function duplicateAndResend() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    const res = await fetch(`/api/campaigns/${campaign.id}/duplicate`, {
      method: "POST",
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return setErr(data.error ?? "Could not duplicate this email.");
    }
    const { campaign: copy } = (await res.json()) as {
      campaign: { id: string };
    };
    router.push(`/communications/campaigns/${copy.id}`);
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTemplatesOpen(true)}
              className="h-7 text-xs"
              title="Start from a template, or save this design as one"
            >
              Templates
            </Button>
          )}
          {!sent && body.blocks.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={saveAsTemplate}
              className="h-7 text-xs"
              title="Save the current design as a reusable template"
            >
              Save as template
            </Button>
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-sm text-amber-500">
            This email has been sent and can no longer be edited.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={duplicateAndResend}
            disabled={busy}
            title="Make an editable copy you can resend — optionally to more people"
          >
            {busy ? "Duplicating…" : "Duplicate & resend"}
          </Button>
        </div>
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

      {templatesOpen && (
        <TemplateGalleryDialog
          starters={CAMPAIGN_TEMPLATES}
          custom={customTemplates}
          onApplyStarter={(id) => applyTemplate(id)}
          onApplyCustom={applyCustomTemplate}
          onDeleteCustom={deleteCustomTemplate}
          onClose={() => setTemplatesOpen(false)}
        />
      )}

      {/* Setup — full width */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Setup</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
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

          <p className="text-xs text-muted-foreground md:col-span-2">
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

      {/* Three-pane builder: palette · live canvas · inspector */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid gap-3 -mx-4 md:-mx-6 lg:grid-cols-[200px_minmax(0,1fr)_330px] lg:items-start">
          {/* Palette */}
          <Card className="self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto">
            <CardHeader className="pb-2 space-y-2">
              <div className="flex items-center justify-between gap-1">
                <SegmentedPicker
                  value={paletteTab}
                  options={[
                    { value: "modules", label: "Modules" },
                    { value: "sections", label: "Sections" },
                  ]}
                  onChange={(v) => setPaletteTab(v as "modules" | "sections")}
                />
              </div>
              <Button
                variant={designOpen ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDesignOpen(true);
                  setSelectedBlockId(null);
                }}
                className="h-7 w-full gap-1 text-xs"
                title="Edit the whole email's background, fonts and colors"
              >
                🎨 Design
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {sent ? (
                <p className="text-xs text-muted-foreground italic">
                  Sent emails can’t be edited.
                </p>
              ) : paletteTab === "modules" ? (
                <>
                  {ADD_GROUPS.map((g) => (
                    <div key={g.group} className="space-y-1">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        {g.group}
                      </p>
                      <div className="flex flex-col gap-1">
                        {g.items.map((t) => (
                          <PaletteItem
                            key={t.type}
                            type={t.type}
                            label={t.label}
                            onClick={() => addBlock(t.type)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="pt-1 text-[10px] text-muted-foreground">
                    Click to add, or drag onto the email.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Column layouts
                  </p>
                  <div className="flex flex-col gap-1">
                    {SECTION_PRESETS.map((p) => (
                      <SectionPaletteItem
                        key={p.layout}
                        layout={p.layout}
                        label={p.label}
                        onClick={() => addSection(p.layout)}
                      />
                    ))}
                  </div>
                  <p className="pt-1 text-[10px] text-muted-foreground">
                    Drop content into each column after adding.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Live canvas */}
          <Card className="self-start">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Canvas</CardTitle>
              <SegmentedPicker
                value={device}
                options={[
                  { value: "desktop", label: "🖥 Desktop" },
                  { value: "mobile", label: "📱 Mobile" },
                ]}
                onChange={(v) => setDevice(v as "desktop" | "mobile")}
              />
            </CardHeader>
            <CardContent className="p-2">
              <EmailCanvas
                body={body}
                brand={brand}
                device={device}
                selectedId={selectedBlockId}
                dragActive={activeDrag !== null}
                onSelect={(id) => selectBlock(id)}
                onRemove={removeBlock}
                onDuplicate={duplicateBlock}
              />
            </CardContent>
          </Card>

          {/* Inspector */}
          <Card className="self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {designOpen
                  ? "Template design"
                  : selectedBlock
                    ? `Edit ${selectedBlock.type}`
                    : "Inspector"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {designOpen ? (
                <DesignPanel
                  design={body.design}
                  disabled={sent}
                  onChange={updateDesign}
                  onClose={() => setDesignOpen(false)}
                />
              ) : selectedBlock ? (
                <div className="space-y-2">
                  {selectedBlock.type === "section" && (
                    <SegmentedPicker
                      label="Layout"
                      value={selectedBlock.layout}
                      disabled={sent}
                      options={[
                        { value: "1-1", label: "2" },
                        { value: "1-1-1", label: "3" },
                        { value: "1-1-1-1", label: "4" },
                        { value: "1-2", label: "1:2" },
                        { value: "2-1", label: "2:1" },
                      ]}
                      onChange={(v) =>
                        setSectionLayout(selectedBlock.id, v as SectionLayout)
                      }
                    />
                  )}
                  <BlockEditor
                    block={selectedBlock}
                    disabled={sent}
                    campaignId={campaign.id}
                    onChange={(patch) => updateBlock(selectedBlock.id, patch)}
                    onRemove={() => removeBlock(selectedBlock.id)}
                    onUp={() => nudgeBlock(selectedBlock.id, -1)}
                    onDown={() => nudgeBlock(selectedBlock.id, 1)}
                    canUp={selectedIdx > 0}
                    canDown={selectedIdx < selectedContainerLen - 1}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Select a block on the canvas, or open{" "}
                  <span className="font-medium">Design</span> for the whole email.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            activeDrag.kind === "palette" ? (
              <div className="pointer-events-none flex items-center gap-1.5 rounded-md border border-sky-500 bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-lg">
                <Plus className="h-3.5 w-3.5" /> Add {activeDrag.label}
              </div>
            ) : (
              <BlockDragGhost
                blockId={activeDrag.blockId}
                body={body}
                theme={previewTheme}
              />
            )
          ) : null}
        </DragOverlay>
      </DndContext>

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
                ✓ Email sent — {sendProgress.sent} delivered to the provider
                {sendProgress.failed > 0 ? `, ${sendProgress.failed} failed` : ""}.
              </p>
            )}
            {sendState === "idle" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-4">
                  <Button onClick={sendNow} disabled={busy}>
                    Send now to {audienceCount}
                  </Button>
                  <span className="text-sm text-muted-foreground">or</span>
                  <div className="flex items-end gap-2">
                    <label className="block">
                      <span className="block text-muted-foreground mb-1 text-xs">
                        Schedule for (your local time, SAST)
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
                {scheduleAt && !Number.isNaN(new Date(scheduleAt).getTime()) && (
                  <p className="text-xs text-muted-foreground">
                    Sends {formatSast(new Date(scheduleAt))}.
                  </p>
                )}
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

function TemplateGalleryDialog({
  starters,
  custom,
  onApplyStarter,
  onApplyCustom,
  onDeleteCustom,
  onClose,
}: {
  starters: { id: string; name: string; tagline: string }[];
  custom: CustomTemplate[];
  onApplyStarter: (id: string) => void;
  onApplyCustom: (t: CustomTemplate) => void;
  onDeleteCustom: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-8 w-full max-w-3xl rounded-lg border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Start from a template</p>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <section>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Starter templates
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {starters.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onApplyStarter(t.id)}
                  className="text-left rounded-lg border p-2.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="font-semibold text-xs">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                    {t.tagline}
                  </div>
                </button>
              ))}
            </div>
          </section>
          <section>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Your templates
            </p>
            {custom.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                None yet — design an email and click “Save as template”.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {custom.map((t) => (
                  <div
                    key={t.id}
                    className="group relative rounded-lg border p-2.5 hover:bg-muted/50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onApplyCustom(t)}
                      className="text-left w-full"
                    >
                      <div className="font-semibold text-xs pr-5">{t.name}</div>
                      {t.tagline && (
                        <div className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                          {t.tagline}
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteCustom(t.id)}
                      className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100"
                      aria-label="Delete template"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// Find a block by id anywhere in the tree (root or a section column).
function findBlockDeep(
  body: CampaignBody,
  id: string
): CampaignBlock | null {
  for (const b of body.blocks) {
    if (b.id === id) return b;
    if (b.type === "section") {
      for (const col of b.columns) {
        for (const cb of col.blocks) if (cb.id === id) return cb;
      }
    }
  }
  return null;
}

// A floating preview of the block being dragged — the real email HTML in a
// small card — so you can see what you're moving and where it will land.
function BlockDragGhost({
  blockId,
  body,
  theme,
}: {
  blockId: string;
  body: CampaignBody;
  theme: Parameters<typeof renderBlock>[1];
}) {
  const block = findBlockDeep(body, blockId);
  if (!block || block.type === "section") {
    return (
      <div className="pointer-events-none rounded-md border-2 border-sky-500 bg-card px-3 py-2 text-xs font-medium shadow-xl">
        {block?.type === "section" ? "Moving section…" : "Moving block…"}
      </div>
    );
  }
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tbody>${renderBlock(
    block,
    theme
  )}</tbody></table>`;
  return (
    <div className="pointer-events-none w-[300px] max-w-[80vw] rotate-1 overflow-hidden rounded-md border-2 border-sky-500 bg-white opacity-95 shadow-xl">
      <div
        className="ff-email-content px-3 py-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// Draggable palette chip. Click to append to the email; drag onto a canvas
// drop-zone (including into a section column) to place precisely.
function PaletteItem({
  type,
  label,
  onClick,
}: {
  type: CampaignBlockType;
  label: string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
    data: { kind: "palette", blockType: type },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      {...attributes}
      {...listeners}
      className={`flex h-7 items-center gap-1 rounded border px-2 text-left text-xs hover:bg-muted cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <Plus className="h-3 w-3" />
      {label}
    </button>
  );
}

// Draggable section-layout preset. Shows a mini column diagram.
function SectionPaletteItem({
  layout,
  label,
  onClick,
}: {
  layout: SectionLayout;
  label: string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:section:${layout}`,
    data: { kind: "palette", blockType: "section", layout },
  });
  const weights = sectionColumnWeights(layout);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      {...attributes}
      {...listeners}
      className={`flex h-9 items-center gap-2 rounded border px-2 text-left text-xs hover:bg-muted cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <span className="flex h-4 w-10 gap-0.5">
        {weights.map((w, i) => (
          <span
            key={i}
            className="rounded-sm bg-muted-foreground/30"
            style={{ flex: `${w / total} 1 0%` }}
          />
        ))}
      </span>
      {label}
    </button>
  );
}

// Global per-email design overrides (Template design). Writes body.design.
function DesignPanel({
  design,
  disabled,
  onChange,
  onClose,
}: {
  design: EmailDesign | undefined;
  disabled: boolean;
  onChange: (patch: Partial<EmailDesign>) => void;
  onClose: () => void;
}) {
  const d = design ?? {};
  const setText = (patch: Partial<NonNullable<EmailDesign["text"]>>) =>
    onChange({ text: { ...d.text, ...patch } });
  const setHeading = (patch: Partial<NonNullable<EmailDesign["heading"]>>) =>
    onChange({ heading: { ...d.heading, ...patch } });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Applies to the whole email, on top of your Brand Kit. Leave a field blank
        to keep the brand default.
      </p>

      <Section title="Background & card">
        <div className="grid grid-cols-2 gap-1.5">
          <ColorField
            label="Page bg"
            value={d.pageBgColor ?? ""}
            disabled={disabled}
            onChange={(v) => onChange({ pageBgColor: v || undefined })}
          />
          <ColorField
            label="Card bg"
            value={d.contentBgColor ?? ""}
            disabled={disabled}
            onChange={(v) => onChange({ contentBgColor: v || undefined })}
          />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <NumField
            label="Width px"
            value={d.contentWidthPx}
            disabled={disabled}
            onChange={(n) => onChange({ contentWidthPx: n })}
          />
          <NumField
            label="Border"
            value={d.borderWidth}
            disabled={disabled}
            onChange={(n) => onChange({ borderWidth: n })}
          />
          <NumField
            label="Radius"
            value={d.borderRadiusPx}
            disabled={disabled}
            onChange={(n) => onChange({ borderRadiusPx: n })}
          />
        </div>
        <ColorField
          label="Border color"
          value={d.borderColor ?? ""}
          disabled={disabled}
          onChange={(v) => onChange({ borderColor: v || undefined })}
        />
      </Section>

      <Section title="Body text">
        <div className="grid grid-cols-2 gap-1.5">
          <FontSelect
            label="Font"
            value={d.text?.fontFamily ?? "body"}
            disabled={disabled}
            onChange={(v) => setText({ fontFamily: v })}
          />
          <ColorField
            label="Text color"
            value={d.text?.color ?? ""}
            disabled={disabled}
            onChange={(v) => setText({ color: v || undefined })}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <NumField
            label="Size px"
            value={d.text?.sizePx}
            disabled={disabled}
            onChange={(n) => setText({ sizePx: n })}
          />
          <NumField
            label="Line ht"
            value={d.text?.lineHeight}
            step="0.1"
            disabled={disabled}
            onChange={(n) => setText({ lineHeight: n })}
          />
        </div>
      </Section>

      <Section title="Headings & links">
        <div className="grid grid-cols-2 gap-1.5">
          <FontSelect
            label="Font"
            value={d.heading?.fontFamily ?? "display"}
            disabled={disabled}
            onChange={(v) => setHeading({ fontFamily: v })}
          />
          <ColorField
            label="Heading color"
            value={d.heading?.color ?? ""}
            disabled={disabled}
            onChange={(v) => setHeading({ color: v || undefined })}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <ColorField
            label="Link color"
            value={d.linkColor ?? ""}
            disabled={disabled}
            onChange={(v) => onChange({ linkColor: v || undefined })}
          />
          <ColorField
            label="Button color"
            value={d.buttonColor ?? ""}
            disabled={disabled}
            onChange={(v) => onChange({ buttonColor: v || undefined })}
          />
        </div>
      </Section>

      <Button
        variant="outline"
        size="sm"
        onClick={onClose}
        className="h-7 w-full text-xs"
      >
        Done
      </Button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded border p-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {title}
      </p>
      {children}
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
          <div className="grid grid-cols-2 gap-1.5">
            <ColorField
              label="Button color"
              value={block.bgColor ?? ""}
              disabled={disabled}
              onChange={(v) => onChange({ bgColor: v || undefined })}
            />
            <ColorField
              label="Text color"
              value={block.textColor ?? ""}
              disabled={disabled}
              onChange={(v) => onChange({ textColor: v || undefined })}
            />
          </div>
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
      {block.type === "columns" && (
        <ColumnsFields block={block} disabled={disabled} onChange={onChange} />
      )}
      {block.type === "social" && (
        <SocialFields block={block} disabled={disabled} onChange={onChange} />
      )}

      <BlockStylePanel block={block} disabled={disabled} onChange={onChange} />
    </div>
  );
}

const SOCIAL_PLATFORMS: SocialLink["platform"][] = [
  "instagram",
  "facebook",
  "youtube",
  "x",
  "tiktok",
  "web",
];

function ColumnsFields({
  block,
  disabled,
  onChange,
}: {
  block: Extract<CampaignBlock, { type: "columns" }>;
  disabled: boolean;
  onChange: (patch: Partial<CampaignBlock>) => void;
}) {
  const cells = block.cells;
  const setCell = (i: number, patch: Partial<ColumnCell>) => {
    const next = cells.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChange({ cells: next } as Partial<CampaignBlock>);
  };
  const setCount = (n: 2 | 3) => {
    let next = cells.slice(0, n);
    while (next.length < n) next = [...next, { heading: "", text: "" }];
    onChange({ cells: next } as Partial<CampaignBlock>);
  };

  return (
    <div className="space-y-2">
      <SegmentedPicker
        label="Columns"
        value={String(Math.min(cells.length, 3)) as "2" | "3"}
        disabled={disabled}
        options={[
          { value: "2", label: "2" },
          { value: "3", label: "3" },
        ]}
        onChange={(v) => setCount(Number(v) as 2 | 3)}
      />
      {cells.slice(0, 3).map((c, i) => (
        <div key={i} className="rounded border p-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Column {i + 1}
          </p>
          <Input
            value={c.heading ?? ""}
            onChange={(e) => setCell(i, { heading: e.target.value || undefined })}
            disabled={disabled}
            placeholder="Heading (optional)"
            className="text-xs"
          />
          <textarea
            value={c.text}
            onChange={(e) => setCell(i, { text: e.target.value })}
            disabled={disabled}
            placeholder="Column text — supports basic paragraphs."
            rows={3}
            className="w-full rounded border bg-background px-2 py-1.5 text-sm resize-none"
          />
        </div>
      ))}
    </div>
  );
}

function SocialFields({
  block,
  disabled,
  onChange,
}: {
  block: Extract<CampaignBlock, { type: "social" }>;
  disabled: boolean;
  onChange: (patch: Partial<CampaignBlock>) => void;
}) {
  const links = block.links ?? [];
  const usingBrand = links.length === 0;

  const setLinks = (next: SocialLink[]) =>
    onChange({ links: next.length ? next : undefined } as Partial<CampaignBlock>);
  const addLink = () =>
    setLinks([...links, { platform: "instagram", url: "https://" }]);
  const setLink = (i: number, patch: Partial<SocialLink>) =>
    setLinks(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLink = (i: number) => setLinks(links.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {usingBrand && (
        <p className="text-xs text-muted-foreground italic">
          Using your brand kit’s social links. Add links below to override.
        </p>
      )}
      {links.map((l, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select
            value={l.platform}
            onChange={(e) =>
              setLink(i, { platform: e.target.value as SocialLink["platform"] })
            }
            disabled={disabled}
            className="rounded border bg-background px-1.5 py-1 text-xs"
          >
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <Input
            value={l.url}
            onChange={(e) => setLink(i, { url: e.target.value })}
            disabled={disabled}
            placeholder="https://…"
            className="h-8 text-xs flex-1"
          />
          <Mini onClick={() => removeLink(i)} label="✕" danger />
        </div>
      ))}
      {!disabled && (
        <Button
          variant="outline"
          size="sm"
          onClick={addLink}
          className="h-7 gap-1 text-xs"
        >
          <Plus className="h-3 w-3" />
          Add link
        </Button>
      )}
    </div>
  );
}

// Blocks that support alignment + background + padding overrides.
const STYLEABLE_BLOCKS: ReadonlySet<CampaignBlockType> = new Set([
  "heading",
  "text",
  "button",
  "image",
  "eyebrow",
  "quote",
  "image-text",
  "cta",
  "columns",
  "social",
  "section",
]);
// Blocks whose main text supports font overrides.
const FONT_BLOCKS: ReadonlySet<CampaignBlockType> = new Set([
  "heading",
  "text",
  "button",
]);

function BlockStylePanel({
  block,
  disabled,
  onChange,
}: {
  block: CampaignBlock;
  disabled: boolean;
  onChange: (patch: Partial<CampaignBlock>) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!STYLEABLE_BLOCKS.has(block.type)) return null;

  const style = block.blockStyle ?? {};
  const setStyle = (patch: Partial<BlockStyle>) =>
    onChange({ blockStyle: { ...style, ...patch } } as Partial<CampaignBlock>);
  const setFont = (patch: Partial<NonNullable<BlockStyle["font"]>>) =>
    setStyle({ font: { ...style.font, ...patch } });
  const setPad = (patch: Partial<NonNullable<BlockStyle["padding"]>>) =>
    setStyle({ padding: { ...style.padding, ...patch } });

  const showFont = FONT_BLOCKS.has(block.type);

  return (
    <div className="rounded border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold"
      >
        Style
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-2">
          <div className="grid grid-cols-2 gap-1.5">
            <ColorField
              label="Background"
              value={style.bgColor ?? ""}
              disabled={disabled}
              onChange={(v) => setStyle({ bgColor: v || undefined })}
            />
            <SegmentedPicker
              label="Align"
              value={style.align ?? "left"}
              disabled={disabled}
              options={[
                { value: "left", label: "L" },
                { value: "center", label: "C" },
                { value: "right", label: "R" },
              ]}
              onChange={(v) =>
                setStyle({ align: v === "left" ? undefined : (v as BlockAlign) })
              }
            />
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <NumField label="Pad top" value={style.padding?.top} disabled={disabled} onChange={(n) => setPad({ top: n })} />
            <NumField label="Right" value={style.padding?.right} disabled={disabled} onChange={(n) => setPad({ right: n })} />
            <NumField label="Bottom" value={style.padding?.bottom} disabled={disabled} onChange={(n) => setPad({ bottom: n })} />
            <NumField label="Left" value={style.padding?.left} disabled={disabled} onChange={(n) => setPad({ left: n })} />
          </div>

          {showFont && (
            <div className="space-y-1.5 border-t pt-2">
              <div className="grid grid-cols-2 gap-1.5">
                <FontSelect
                  label="Font"
                  value={style.font?.family ?? "body"}
                  disabled={disabled}
                  onChange={(v) => setFont({ family: v })}
                />
                <ColorField
                  label="Text color"
                  value={style.font?.color ?? ""}
                  disabled={disabled}
                  onChange={(v) => setFont({ color: v || undefined })}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">
                  Style
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setFont({
                      weight:
                        (style.font?.weight ?? 0) >= 700
                          ? undefined
                          : (700 as BlockFontWeight),
                    })
                  }
                  className={`h-6 w-7 rounded border text-xs font-bold transition-colors disabled:opacity-30 ${
                    (style.font?.weight ?? 0) >= 700
                      ? "bg-foreground text-background"
                      : "bg-background hover:bg-muted text-muted-foreground"
                  }`}
                  aria-pressed={(style.font?.weight ?? 0) >= 700}
                  title="Bold"
                >
                  B
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setFont({ italic: style.font?.italic ? undefined : true })
                  }
                  className={`h-6 w-7 rounded border text-xs italic transition-colors disabled:opacity-30 ${
                    style.font?.italic
                      ? "bg-foreground text-background"
                      : "bg-background hover:bg-muted text-muted-foreground"
                  }`}
                  aria-pressed={!!style.font?.italic}
                  title="Italic"
                >
                  I
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <NumField label="Size px" value={style.font?.sizePx} disabled={disabled} onChange={(n) => setFont({ sizePx: n })} />
                <NumField label="Line ht" value={style.font?.lineHeight} step="0.1" disabled={disabled} onChange={(n) => setFont({ lineHeight: n })} />
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Weight</span>
                  <select
                    value={style.font?.weight ?? ""}
                    onChange={(e) =>
                      setFont({
                        weight: e.target.value
                          ? (Number(e.target.value) as BlockFontWeight)
                          : undefined,
                      })
                    }
                    disabled={disabled}
                    className="w-full rounded border bg-background px-1 py-1 text-xs"
                  >
                    <option value="">Default</option>
                    <option value="400">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">Semibold</option>
                    <option value="700">Bold</option>
                    <option value="800">Black</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-7 w-8 rounded border bg-background p-0.5 disabled:opacity-30"
          aria-label={`${label} picker`}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="brand"
          className="h-7 text-xs flex-1"
        />
      </div>
    </label>
  );
}

function NumField({
  label,
  value,
  disabled,
  step,
  onChange,
}: {
  label: string;
  value: number | undefined;
  disabled?: boolean;
  step?: string;
  onChange: (n: number | undefined) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
        {label}
      </span>
      <input
        type="number"
        value={value ?? ""}
        step={step}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
        disabled={disabled}
        className="w-full rounded border bg-background px-1.5 py-1 text-xs disabled:opacity-30"
      />
    </label>
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

// Grouped font dropdown backed by FONT_CATALOG. Brand fonts first, then a
// curated menu of web-safe families and Google webfonts, grouped by style.
const FONT_GROUPS: { label: string; group: string }[] = [
  { label: "Brand", group: "brand" },
  { label: "Sans-serif", group: "sans" },
  { label: "Serif", group: "serif" },
  { label: "Monospace", group: "mono" },
];

function FontSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label?: string;
  value: BlockFontFamily;
  disabled?: boolean;
  onChange: (v: BlockFontFamily) => void;
}) {
  return (
    <label className="block min-w-0">
      {label && (
        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
          {label}
        </span>
      )}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as BlockFontFamily)}
        className="h-7 w-full rounded border bg-background px-1.5 text-[11px] disabled:opacity-30"
      >
        {FONT_GROUPS.map((g) => (
          <optgroup key={g.group} label={g.label}>
            {FONT_CATALOG.filter((f) => f.group === g.group).map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
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
  const [preparing, setPreparing] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function fileToDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // On pick: convert HEIC → JPEG if needed, then open the crop dialog.
  async function pickFile(file: File) {
    setErr(null);
    setPreparing(true);
    try {
      let blob: Blob = file;
      if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
        const heic2any = (await import("heic2any")).default;
        const out = await heic2any({
          blob: file,
          toType: "image/jpeg",
          quality: 0.92,
        });
        blob = Array.isArray(out) ? out[0] : out;
      }
      setCropSrc(await fileToDataUrl(blob));
    } catch {
      setErr("Could not read that image.");
    } finally {
      setPreparing(false);
    }
  }

  async function upload(file: Blob, filename: string) {
    setUploading(true);
    setErr(null);
    const fd = new FormData();
    fd.append("file", file, filename);
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
                disabled={disabled || uploading || preparing}
                onClick={() => inputRef.current?.click()}
                className="h-6 px-2 text-[11px]"
              >
                {preparing ? "Reading…" : uploading ? "Uploading…" : "Replace"}
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
          disabled={disabled || uploading || preparing}
          onClick={() => inputRef.current?.click()}
          className="w-full gap-1.5"
        >
          {preparing ? "Reading…" : uploading ? "Uploading…" : "Upload & crop image"}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pickFile(f);
          e.target.value = "";
        }}
      />
      {cropSrc && (
        <ImageCropDialog
          imageSrc={cropSrc}
          onCancel={() => setCropSrc(null)}
          onCropped={(blob) => {
            setCropSrc(null);
            upload(blob, "cropped.jpg");
          }}
        />
      )}
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
    case "columns":
      return `${b.cells.length}-column layout`;
    case "social":
      return b.links && b.links.length
        ? `${b.links.length} social links`
        : "Social links (from brand)";
    default:
      return "";
  }
}
