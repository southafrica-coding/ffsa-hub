"use client";

import { useDroppable } from "@dnd-kit/core";

// Thin insertion target between blocks (and inside empty columns). id encodes
// the destination: `drop:<container>:<index>` where container is "root" or a
// column id. Highlights when something is dragged over it.
export function DropZone({
  container,
  index,
  full,
}: {
  container: string;
  index: number;
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
            ? "border-sky-400 bg-sky-400/10 text-sky-500"
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
      className={`transition-all ${
        isOver
          ? "my-1 h-5 rounded border border-dashed border-sky-400 bg-sky-400/20"
          : "h-2"
      }`}
      aria-hidden
    />
  );
}
