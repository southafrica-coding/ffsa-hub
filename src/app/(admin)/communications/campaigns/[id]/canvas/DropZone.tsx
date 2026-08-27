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
  insertTarget,
  full,
}: {
  container: string;
  index: number;
  dragActive: boolean;
  /** Resolved landing spot for the current drag (may be a block's half). */
  insertTarget?: { container: string; index: number } | null;
  /** Full-height variant for empty columns ("Drop content here"). */
  full?: boolean;
}) {
  const { setNodeRef, isOver: hovered } = useDroppable({
    id: `drop:${container}:${index}`,
    data: { kind: "dropzone", container, index },
  });
  // Also light up when the drag is over an adjacent block half that resolves
  // to this same insertion point.
  const isOver =
    hovered ||
    (insertTarget?.container === container && insertTarget?.index === index);

  if (full) {
    return (
      <div
        ref={setNodeRef}
        className={`flex min-h-[80px] items-center justify-center rounded-md border-2 border-dashed text-xs font-medium transition-colors ${
          isOver
            ? "border-sky-500 bg-sky-400/20 text-sky-600"
            : "border-muted-foreground/30 text-muted-foreground"
        }`}
      >
        Drop content here
      </div>
    );
  }

  // A wider hit area during a drag makes zones easy to target; the visible
  // indicator is a thin bar that becomes a solid sky line right where the
  // block will land.
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className={`relative transition-all ${
        dragActive ? "h-6 my-0.5" : "h-2"
      }`}
    >
      <div
        className={`absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full transition-all ${
          isOver
            ? "h-1.5 bg-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.2)]"
            : dragActive
              ? "h-0.5 bg-sky-300/70"
              : "h-0"
        }`}
      />
      {isOver && (
        <>
          <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500" />
          <span className="absolute right-0 top-1/2 h-2.5 w-2.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500" />
        </>
      )}
    </div>
  );
}
