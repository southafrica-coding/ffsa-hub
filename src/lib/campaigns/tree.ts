// Pure, immutable operations on a CampaignBody block tree.
//
// The tree is at most 2 deep: root blocks, and section columns holding leaf
// blocks. A "container" is either "root" or a section column's id. All builder
// mutations (drag/drop, add, remove, reorder) go through these helpers so the
// composer never mutates nested arrays by hand.

import {
  type CampaignBlock,
  type CampaignBody,
  type SectionColumn,
  type SectionLayout,
  sectionColumnWeights,
  newBlockId,
} from "./blocks";

export const ROOT: "root" = "root";
export type ContainerId = "root" | string; // "root" or a column id

type SectionBlock = Extract<CampaignBlock, { type: "section" }>;
const isSection = (b: CampaignBlock): b is SectionBlock => b.type === "section";

export function newColumn(): SectionColumn {
  return { id: newBlockId(), blocks: [] };
}

export function newSection(layout: SectionLayout): SectionBlock {
  const n = sectionColumnWeights(layout).length;
  return {
    id: newBlockId(),
    type: "section",
    layout,
    columns: Array.from({ length: n }, newColumn),
  };
}

/** Read the block list for a container (does not mutate). */
export function getContainer(
  body: CampaignBody,
  container: ContainerId
): CampaignBlock[] {
  if (container === ROOT) return body.blocks;
  for (const b of body.blocks) {
    if (isSection(b)) {
      const col = b.columns.find((c) => c.id === container);
      if (col) return col.blocks;
    }
  }
  return [];
}

/** Locate a block by id → its container and index, or null. */
export function findLocation(
  body: CampaignBody,
  blockId: string
): { container: ContainerId; index: number } | null {
  const ri = body.blocks.findIndex((b) => b.id === blockId);
  if (ri >= 0) return { container: ROOT, index: ri };
  for (const b of body.blocks) {
    if (isSection(b)) {
      for (const col of b.columns) {
        const i = col.blocks.findIndex((x) => x.id === blockId);
        if (i >= 0) return { container: col.id, index: i };
      }
    }
  }
  return null;
}

function mapContainer(
  body: CampaignBody,
  container: ContainerId,
  fn: (list: CampaignBlock[]) => CampaignBlock[]
): CampaignBody {
  if (container === ROOT) return { ...body, blocks: fn(body.blocks) };
  return {
    ...body,
    blocks: body.blocks.map((b) =>
      isSection(b)
        ? {
            ...b,
            columns: b.columns.map((c) =>
              c.id === container ? { ...c, blocks: fn(c.blocks) } : c
            ),
          }
        : b
    ),
  };
}

export function insertAt(
  body: CampaignBody,
  container: ContainerId,
  index: number,
  block: CampaignBlock
): CampaignBody {
  return mapContainer(body, container, (list) => {
    const next = [...list];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, block);
    return next;
  });
}

export function removeById(body: CampaignBody, blockId: string): CampaignBody {
  const loc = findLocation(body, blockId);
  if (!loc) return body;
  return mapContainer(body, loc.container, (list) =>
    list.filter((b) => b.id !== blockId)
  );
}

/** True if a container id refers to root or an existing section column. */
export function containerExists(
  body: CampaignBody,
  container: ContainerId
): boolean {
  if (container === ROOT) return true;
  return body.blocks.some(
    (b) => isSection(b) && b.columns.some((c) => c.id === container)
  );
}

/** Move a block to a destination container+index (used by drag reorder). */
export function moveBlock(
  body: CampaignBody,
  blockId: string,
  destContainer: ContainerId,
  destIndex: number
): CampaignBody {
  const loc = findLocation(body, blockId);
  if (!loc) return body;
  const block = getContainer(body, loc.container)[loc.index];
  if (!block) return body;
  // Guard: never lose a block to a non-existent target, and never nest a
  // section inside a column (keeps the tree at most 2 deep).
  if (!containerExists(body, destContainer)) return body;
  if (destContainer !== ROOT && block.type === "section") return body;

  let next = removeById(body, blockId);
  // If removing from the same container shifts indices, adjust.
  let idx = destIndex;
  if (loc.container === destContainer && loc.index < destIndex) idx -= 1;
  next = insertAt(next, destContainer, idx, block);
  return next;
}

/** Shallow-merge a patch onto the block with the given id, wherever it lives. */
export function updateBlockById(
  body: CampaignBody,
  blockId: string,
  patch: Partial<CampaignBlock>
): CampaignBody {
  const apply = (b: CampaignBlock): CampaignBlock =>
    b.id === blockId ? ({ ...b, ...patch } as CampaignBlock) : b;
  return {
    ...body,
    blocks: body.blocks.map((b) => {
      // Target is this block (section or leaf) — merge the patch verbatim
      // (including a `columns`/`layout` patch on a section).
      if (b.id === blockId) return { ...b, ...patch } as CampaignBlock;
      // Otherwise recurse into a section's columns to update nested children.
      if (isSection(b)) {
        return {
          ...b,
          columns: b.columns.map((c) => ({ ...c, blocks: c.blocks.map(apply) })),
        };
      }
      return b;
    }),
  };
}

/** Flat list of every block id (root + nested) — for SortableContext items. */
export function allBlockIds(body: CampaignBody): string[] {
  const ids: string[] = [];
  for (const b of body.blocks) {
    ids.push(b.id);
    if (isSection(b)) for (const c of b.columns) for (const x of c.blocks) ids.push(x.id);
  }
  return ids;
}
