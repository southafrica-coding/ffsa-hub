"use client";

import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Copy, Trash2 } from "lucide-react";
import {
  renderBlock,
  type CampaignBlock,
  type Theme,
} from "@/lib/campaigns/blocks";
import { CanvasSection } from "./CanvasSection";

// A single block in the WYSIWYG canvas. Leaf blocks render the ACTUAL email
// HTML (via renderBlock) so the canvas == the sent email; sections delegate to
// CanvasSection. The only drop targets are the insertion DropZones, so
// placement is predictable (no sortable flicker). Leaf blocks drag from their
// body (a small move starts a drag, a tap selects); sections drag from a handle
// so their draggable children don't conflict.
export function CanvasBlock({
  block,
  theme,
  container,
  selectedId,
  dragActive,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  block: CampaignBlock;
  theme: Theme;
  container: string;
  selectedId: string | null;
  dragActive: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: block.id,
    data: { kind: "block", container },
  });
  const selected = selectedId === block.id;
  const isSection = block.type === "section";

  // Action buttons (duplicate/delete). onPointerDown stop keeps a body-drag
  // from starting when you grab a button.
  const actions = (
    <>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate(block.id);
        }}
        className="p-1 text-muted-foreground hover:text-foreground"
        aria-label="Duplicate"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(block.id);
        }}
        className="p-1 text-muted-foreground hover:text-red-400"
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </>
  );

  const outline = selected
    ? "outline outline-2 outline-sky-500"
    : "hover:outline hover:outline-1 hover:outline-sky-300";

  if (isSection) {
    // Handle-based drag: the grip carries the drag listeners; the body doesn't,
    // so nested column blocks drag independently.
    return (
      <div
        ref={setNodeRef}
        onClick={() => onSelect(block.id)}
        className={`group relative rounded ${outline} ${
          isDragging ? "opacity-40" : ""
        }`}
      >
        <div
          className="absolute -top-3 right-1 z-10 hidden gap-0.5 rounded border bg-card p-0.5 shadow-sm group-hover:flex"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label="Drag section"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          {actions}
        </div>
        <CanvasSection
          block={block}
          theme={theme}
          selectedId={selectedId}
          dragActive={dragActive}
          onSelect={onSelect}
          onRemove={onRemove}
          onDuplicate={onDuplicate}
        />
      </div>
    );
  }

  // Leaf: the whole block is draggable; a tap (no move) selects.
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tbody>${renderBlock(
    block,
    theme
  )}</tbody></table>`;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        onSelect(block.id);
      }}
      className={`group relative cursor-grab rounded transition-shadow active:cursor-grabbing ${outline} ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div
        className="absolute -top-3 right-1 z-10 hidden gap-0.5 rounded border bg-card p-0.5 shadow-sm group-hover:flex"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="flex cursor-grab items-center p-1 text-muted-foreground active:cursor-grabbing"
          aria-hidden
          title="Drag to move"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        {actions}
      </div>
      <div className="ff-email-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
