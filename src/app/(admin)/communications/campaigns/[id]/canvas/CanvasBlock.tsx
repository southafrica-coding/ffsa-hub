"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Copy, Trash2 } from "lucide-react";
import {
  renderBlock,
  type CampaignBlock,
  type Theme,
} from "@/lib/campaigns/blocks";
import { CanvasSection } from "./CanvasSection";

// A single block in the WYSIWYG canvas. Leaf blocks render the ACTUAL email
// HTML (via renderBlock) so the canvas == the sent email; sections delegate to
// CanvasSection (which needs nested drop targets). A React wrapper adds the
// selection outline, hover controls, and drag handle.
export function CanvasBlock({
  block,
  theme,
  container,
  selectedId,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  block: CampaignBlock;
  theme: Theme;
  container: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: block.id,
      data: { kind: "block", container },
    });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const selected = selectedId === block.id;

  const chrome = (
    <div
      className="absolute -top-3 right-1 z-10 hidden gap-0.5 rounded border bg-card p-0.5 shadow-sm group-hover:flex"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Drag"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onDuplicate(block.id)}
        className="p-1 text-muted-foreground hover:text-foreground"
        aria-label="Duplicate"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onRemove(block.id)}
        className="p-1 text-muted-foreground hover:text-red-400"
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  if (block.type === "section") {
    return (
      <div
        ref={setNodeRef}
        style={style}
        onClick={() => onSelect(block.id)}
        className={`group relative rounded ${
          selected ? "outline outline-2 outline-sky-500" : ""
        }`}
      >
        {chrome}
        <CanvasSection
          block={block}
          theme={theme}
          selectedId={selectedId}
          onSelect={onSelect}
          onRemove={onRemove}
          onDuplicate={onDuplicate}
        />
      </div>
    );
  }

  // Leaf: render the real email HTML for this block. renderBlock returns a
  // <tr><td>… row, so wrap it in a table to give it a valid parent.
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tbody>${renderBlock(
    block,
    theme
  )}</tbody></table>`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={(e) => {
        // Don't follow links inside the rendered block while editing.
        if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        onSelect(block.id);
      }}
      className={`group relative cursor-pointer rounded transition-shadow ${
        selected
          ? "outline outline-2 outline-sky-500"
          : "hover:outline hover:outline-1 hover:outline-sky-300"
      }`}
    >
      {chrome}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
