"use client";

import { useDroppable } from "@dnd-kit/core";

// Insertion target between blocks (and inside empty columns). id encodes the
// destination: `drop:<container>:<index>` (container is "root" or a column id).
// Faint while a drag is active, strong when hovered — the only drop targets in
// the canvas, so placement is predictable.
export function DropZone({
  container,
  index,
  dragActive,
  full,
}: {
  container: string;
  index: number;
  dragActive: boolean;
  /** Full-height variant for empty columns ("Drop content here"). */
  full?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${container}:${index}`,
    data: { kind: "dropzone", container, index },
  });

  if (full) {
    return (
      <div
        ref={setNodeRef}
        className={`flex min-h-[72px] items-center justify-center rounded border border-dashed text-xs transition-colors ${
          isOver
            ? "border-sky-500 bg-sky-400/15 text-sky-600"
            : "border-muted-foreground/30 text-muted-foreground"
        }`}
      >
        Drop content here
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className={`transition-all ${
        isOver
          ? "my-1 h-7 rounded border-2 border-dashed border-sky-500 bg-sky-400/20"
          : dragActive
            ? "my-0.5 h-4 rounded border border-dashed border-sky-300/60"
            : "h-2"
      }`}
    />
  );
}
