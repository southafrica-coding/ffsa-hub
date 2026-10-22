"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Drawer, StatusPill } from "@/components/ffsa";
import { FeedbackDetailPanel } from "@/components/hub-feedback/feedback-detail";
import {
  KIND_META,
  STATUS_META,
  fmtFeedbackDate,
  isFeedbackKind,
  isFeedbackStatus,
} from "@/lib/hub-feedback/constants";
import type { FeedbackListItem } from "@/lib/hub-feedback/types";

export function MyFeedbackList({
  items,
  initialOpenId,
}: {
  items: FeedbackListItem[];
  initialOpenId: string | null;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(
    initialOpenId && items.some((i) => i.id === initialOpenId) ? initialOpenId : null
  );

  if (items.length === 0) {
    return (
      <div className="px-5 py-12 text-center md:px-8">
        <p className="mono-label">
          Nothing sent yet — use the feedback button (the speech bubble with a +) on any page
        </p>
      </div>
    );
  }

  return (
    <>
      <ul>
        {items.map((f) => {
          const status = isFeedbackStatus(f.status) ? STATUS_META[f.status] : null;
          return (
            <li key={f.id} className="border-b border-rule">
              {/* Not a <button>: the global button rule sets mono caps, and this is a row. */}
              <div
                role="link"
                tabIndex={0}
                onClick={() => setOpenId(f.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenId(f.id);
                  }
                }}
                className="flex w-full cursor-pointer items-start gap-4 px-5 py-3.5 text-left hover:bg-bone md:px-8"
              >
                <span className="w-10 shrink-0 pt-0.5 font-mono text-[11px] text-[#7C786C]">#{f.ref}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-ink">{f.title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-[color:var(--text-secondary)]">
                    {isFeedbackKind(f.kind) ? KIND_META[f.kind].label : f.kind}
                    {f.module_label ? ` · ${f.module_label}` : ""} · {fmtFeedbackDate(f.created_at)}
                  </span>
                  {f.status_note && f.status !== "new" && (
                    <span className="mt-1 block text-[12.5px] text-ink">“{f.status_note}”</span>
                  )}
                  {status && (
                    <span className="mt-2 block md:hidden">
                      <StatusPill tone={status.tone}>{status.forSubmitter}</StatusPill>
                    </span>
                  )}
                </span>
                {status && (
                  <span className="hidden shrink-0 md:block">
                    <StatusPill tone={status.tone}>{status.forSubmitter}</StatusPill>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Drawer open={!!openId} onClose={() => setOpenId(null)} label="Your feedback">
        {openId && <FeedbackDetailPanel id={openId} onChanged={() => router.refresh()} />}
      </Drawer>
    </>
  );
}
