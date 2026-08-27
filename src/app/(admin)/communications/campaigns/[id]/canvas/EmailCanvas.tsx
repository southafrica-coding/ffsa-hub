"use client";

import { resolveTheme, type CampaignBody } from "@/lib/campaigns/blocks";
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
  dragActive,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  body: CampaignBody;
  brand: EffectiveBrand;
  device: "desktop" | "mobile";
  selectedId: string | null;
  dragActive: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const theme = resolveTheme(brand, body.design);
  const width = device === "mobile" ? 375 : theme.contentWidth;

  return (
    <div
      data-dnd-no-autoscroll
      className="flex min-h-[70vh] items-start justify-center overflow-x-auto rounded p-6 md:p-10"
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
        {theme.showHeader && (
          <>
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
          </>
        )}
        <div
          style={{
            padding: device === "mobile" ? "20px 24px 40px" : "20px 56px 40px",
          }}
        >
          {body.blocks.length === 0 ? (
            <DropZone container="root" index={0} dragActive={dragActive} full />
          ) : (
            <>
              <DropZone container="root" index={0} dragActive={dragActive} />
              {body.blocks.map((b, i) => (
                <div key={b.id}>
                  <CanvasBlock
                    block={b}
                    theme={theme}
                    container="root"
                    selectedId={selectedId}
                    dragActive={dragActive}
                    onSelect={onSelect}
                    onRemove={onRemove}
                    onDuplicate={onDuplicate}
                  />
                  <DropZone
                    container="root"
                    index={i + 1}
                    dragActive={dragActive}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
