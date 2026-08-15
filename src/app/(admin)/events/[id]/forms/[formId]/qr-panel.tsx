"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function QrPanel({ url, formName }: { url: string; formName: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { width: 720, margin: 2, errorCorrectionLevel: "M" })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [url]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${formName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`;
    a.click();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">QR code</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Show this to the crowd. Scanning it opens the form. Publish the form first
          so the link is live.
        </p>
        <div className="flex items-center gap-4">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt="Form QR code"
              className="w-36 h-36 border bg-white"
            />
          ) : (
            <div className="w-36 h-36 border bg-[color:var(--surface-2)]" />
          )}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              className="block px-3 py-1.5 border text-sm hover:bg-[color:var(--surface-2)]"
            >
              Show full screen
            </button>
            <button
              type="button"
              onClick={download}
              disabled={!dataUrl}
              className="block px-3 py-1.5 border text-sm hover:bg-[color:var(--surface-2)] disabled:opacity-50"
            >
              Download PNG
            </button>
            <p className="text-xs text-muted-foreground font-mono break-all max-w-[220px]">
              {url}
            </p>
          </div>
        </div>
      </CardContent>

      {fullscreen && dataUrl && (
        <div
          className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center cursor-pointer"
          onClick={() => setFullscreen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt="Form QR code" className="w-[70vmin] h-[70vmin]" />
          <p className="mt-6 text-lg font-medium">{formName}</p>
          <p className="text-sm text-[color:var(--text-tertiary)] mt-1">Tap anywhere to close</p>
        </div>
      )}
    </Card>
  );
}
