"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShareLinkQr } from "@/components/share/share-link-qr";

export function QrPanel({ url, formName }: { url: string; formName: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">QR code</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Show this to the crowd. Scanning it opens the form. Publish the form first
          so the link is live.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <p className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground">
            {url}
          </p>
          <ShareLinkQr
            url={url}
            filename={url}
            label={`QR code for ${formName}`}
            fullscreenCaption={formName}
          />
        </div>
      </CardContent>
    </Card>
  );
}
