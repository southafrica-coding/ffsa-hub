"use client";

import {
  sectionColumnWeights,
  type CampaignBlock,
  type Theme,
} from "@/lib/campaigns/blocks";
import { CanvasBlock } from "./CanvasBlock";
import { DropZone } from "./DropZone";

// Renders a section's columns as a flex row (widths from the shared weights
// helper, so proportions match the email). Each column holds CanvasBlocks with
// insertion DropZones between them; empty columns show a full drop target.
export function CanvasSection({
  block,
  theme,
  selectedId,
  dragActive,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  block: Extract<CampaignBlock, { type: "section" }>;
  theme: Theme;
  selectedId: string | null;
  dragActive: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const weights = sectionColumnWeights(block.layout);
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="flex gap-2 p-1">
      {block.columns.map((col, i) => {
        const w = (weights[i] ?? 1) / total;
        return (
          <div
            key={col.id}
            style={{ flex: `${w} 1 0%` }}
            className="min-w-0 rounded border border-dashed border-muted-foreground/20 p-1"
          >
            {col.blocks.length === 0 ? (
              <DropZone
                container={col.id}
                index={0}
                dragActive={dragActive}
                full
              />
            ) : (
              <>
                <DropZone container={col.id} index={0} dragActive={dragActive} />
                {col.blocks.map((b, idx) => (
                  <div key={b.id}>
                    <CanvasBlock
                      block={b}
                      theme={theme}
                      container={col.id}
                      selectedId={selectedId}
                      dragActive={dragActive}
                      onSelect={onSelect}
                      onRemove={onRemove}
                      onDuplicate={onDuplicate}
                    />
                    <DropZone
                      container={col.id}
                      index={idx + 1}
                      dragActive={dragActive}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
