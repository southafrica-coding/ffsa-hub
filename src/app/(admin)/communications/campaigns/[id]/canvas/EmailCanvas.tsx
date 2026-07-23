"use client";

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  resolveTheme,
  type CampaignBody,
} from "@/lib/campaigns/blocks";
import type { EffectiveBrand } from "@/services/brand";
import { CanvasBlock } from "./CanvasBlock";
import { DropZone } from "./DropZone";

// The WYSIWYG canvas: reproduces the email "paper" (page bg, centered card,
// brand band + logo) as React, and hosts the root block list. Each block
// renders the real email HTML; the card chrome comes from the resolved theme,
// so the canvas closely matches the sent email.
export function EmailCanvas({
  body,
  brand,
  device,
  selectedId,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  body: CampaignBody;
  brand: EffectiveBrand;
  device: "desktop" | "mobile";
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const theme = resolveTheme(brand, body.design);
  const width = device === "mobile" ? 375 : theme.contentWidth;
  const rootIds = body.blocks.map((b) => b.id);

  return (
    <div
      className="overflow-x-auto rounded p-4 md:p-6"
      style={{ background: theme.pageBg }}
    >
      <div
        className="mx-auto"
        style={{
          width,
          maxWidth: "100%",
          background: theme.contentBg,
          borderRadius: theme.cardBorderRadius,
          border: theme.cardBorderWidth
            ? `${theme.cardBorderWidth}px solid ${theme.cardBorderColor}`
            : undefined,
        }}
      >
        <div
          style={{
            height: 4,
            background: theme.primary_color,
            borderRadius: `${theme.cardBorderRadius}px ${theme.cardBorderRadius}px 0 0`,
          }}
        />
        {theme.logo_url && (
          <div style={{ padding: "28px 56px 4px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={theme.logo_url}
              alt={theme.org_name}
              style={{ maxHeight: 48, maxWidth: 200, height: "auto" }}
            />
          </div>
        )}
        <div
          style={{
            padding: device === "mobile" ? "20px 24px 40px" : "20px 56px 40px",
          }}
        >
          <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
            {body.blocks.length === 0 ? (
              <DropZone container="root" index={0} full />
            ) : (
              <>
                <DropZone container="root" index={0} />
                {body.blocks.map((b, i) => (
                  <div key={b.id}>
                    <CanvasBlock
                      block={b}
                      theme={theme}
                      container="root"
                      selectedId={selectedId}
                      onSelect={onSelect}
                      onRemove={onRemove}
                      onDuplicate={onDuplicate}
                    />
                    <DropZone container="root" index={i + 1} />
                  </div>
                ))}
              </>
            )}
          </SortableContext>
        </div>
      </div>
    </div>
  );
}
