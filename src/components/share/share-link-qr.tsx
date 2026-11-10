"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  isAbsoluteHttpUrl,
  shareQrFilename,
  shareQrPngDataUrl,
} from "./share-qr-png";

export { doorShareQrUrl, isAbsoluteHttpUrl, ticketShareQrUrl } from "./share-qr-png";

const DISPLAY_SIZE = 180;

/**
 * QR for one share URL. Modules stay black on a white plate with a quiet
 * zone, including in dark mode — scanners cannot read an inverted code.
 * The encoded value is `url`, the same string shown and copied beside it.
 */
export function ShareLinkQr({
  url,
  filename,
  label,
  showCopy = true,
  fullscreenCaption,
}: {
  url: string;
  /** Slug (or share-url) used for `<slug>-qr.png`. */
  filename: string;
  /** Accessible name for the code, e.g. "QR code for the public event page". */
  label: string;
  /** Turn off when a Copy control already sits on the link. */
  showCopy?: boolean;
  /** When set, offers a full-screen white plate (crowd / stage). */
  fullscreenCaption?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const scannable = isAbsoluteHttpUrl(url);

  async function download() {
    if (!scannable) return;
    setDownloading(true);
    try {
      const dataUrl = await shareQrPngDataUrl(url);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = shareQrFilename(filename);
      a.click();
    } catch {
      toast.error("Couldn't build the QR image.");
    } finally {
      setDownloading(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        toast.error("Couldn't copy — select the link and copy it by hand.");
        return;
      }
    }
    setCopied(true);
    toast.success("Link copied");
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex w-fit max-w-full min-w-0 flex-col items-start gap-3">
      {scannable ? (
        <div
          data-qr-plate
          style={{
            backgroundColor: "#FFFFFF",
            padding: 12,
            lineHeight: 0,
            filter: "none",
            colorScheme: "light",
            width: DISPLAY_SIZE + 24,
            maxWidth: "100%",
            boxSizing: "border-box",
          }}
        >
          <QRCodeSVG
            value={url}
            size={DISPLAY_SIZE}
            level="M"
            marginSize={4}
            bgColor="#FFFFFF"
            fgColor="#000000"
            title={label}
            aria-label={label}
            style={{ display: "block", width: "100%", height: "auto" }}
          />
        </div>
      ) : (
        <div
          data-qr-placeholder
          className="flex items-center border border-border bg-white px-3 py-3 text-xs text-muted-foreground"
          style={{ width: DISPLAY_SIZE + 24, minHeight: 96, boxSizing: "border-box" }}
        >
          QR code appears once the full link is ready.
        </div>
      )}
      <div className="flex max-w-full flex-wrap gap-2">
        <button
          type="button"
          onClick={download}
          disabled={!scannable || downloading}
          className="border border-ink bg-white px-3 py-1.5 text-xs text-ink hover:bg-[color:var(--surface-2)] disabled:opacity-50"
        >
          {downloading ? "Preparing…" : "Download PNG"}
        </button>
        {showCopy && scannable && (
          <button
            type="button"
            onClick={copy}
            className="border border-ink bg-white px-3 py-1.5 text-xs text-ink hover:bg-[color:var(--surface-2)]"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        )}
        {fullscreenCaption && scannable && (
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="border border-ink bg-white px-3 py-1.5 text-xs text-ink hover:bg-[color:var(--surface-2)]"
          >
            Show full screen
          </button>
        )}
      </div>

      {fullscreen && scannable && fullscreenCaption && (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center"
          style={{ backgroundColor: "#FFFFFF", colorScheme: "light", filter: "none" }}
          onClick={() => setFullscreen(false)}
          role="dialog"
          aria-label={label}
        >
          <QRCodeSVG
            value={url}
            size={512}
            level="M"
            marginSize={4}
            bgColor="#FFFFFF"
            fgColor="#000000"
            title={label}
            aria-label={label}
            style={{ width: "min(70vmin, 512px)", height: "auto" }}
          />
          <p className="mt-6 text-lg font-medium" style={{ color: "#0A0A0A" }}>
            {fullscreenCaption}
          </p>
          <p className="mt-1 text-sm" style={{ color: "#45423B" }}>
            Tap anywhere to close
          </p>
        </div>
      )}
    </div>
  );
}
