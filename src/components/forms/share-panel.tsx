"use client";

import { ShareLinkQr } from "@/components/share/share-link-qr";
import { isAbsoluteHttpUrl } from "@/components/share/share-qr-png";
import type { FormAccessMode } from "@/lib/forms/schema";

const ACCESS_NOTE: Record<FormAccessMode, string> = {
  public: "Anyone with this link can fill it in.",
  logged_in: "People sign in to the Hub first, then fill it in.",
  token: "Opens only from a personal link. Those links are not made yet, so this form is closed for now.",
};

/**
 * The share block: the /f/<slug> link and its QR. This was the event
 * builder's QR panel; it is the same ShareLinkQr, so a code printed from
 * an event form and one from /forms scan the same way.
 */
export function SharePanel({
  url,
  formName,
  accessMode,
  isActive,
}: {
  /** Absolute once the page knows its origin; "" until then. */
  url: string;
  formName: string;
  accessMode: FormAccessMode;
  isActive: boolean;
}) {
  const scannable = isAbsoluteHttpUrl(url) ? url : "";
  return (
    <div className="border border-[color:var(--rule-strong)] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="mono-label">Share</p>
          {url ? (
            <p className="mt-1 break-all text-[14px]">{url}</p>
          ) : (
            <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)]">
              The full link appears once this page is open.
            </p>
          )}
          <p className="mt-2 text-[13px] leading-snug text-[color:var(--text-secondary)]">
            {ACCESS_NOTE[accessMode]}
            {!isActive && " Publish the form first so the link is live."}
          </p>
        </div>
        <ShareLinkQr
          url={scannable}
          filename={scannable || formName}
          label={`QR code for ${formName}`}
          fullscreenCaption={formName}
        />
      </div>
    </div>
  );
}
