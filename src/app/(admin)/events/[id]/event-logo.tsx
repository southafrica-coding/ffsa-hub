"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EventLogo({
  eventId,
  logoUrl,
}: {
  eventId: string;
  logoUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(logoUrl);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/events/${eventId}/logo`, {
      method: "POST",
      body: fd,
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Upload failed");
      return;
    }
    const { logoUrl: url } = (await res.json()) as { logoUrl: string };
    setCurrent(url);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}/logo`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to remove");
      return;
    }
    setCurrent(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Event logo</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Shown at the top of every form for this event. PNG, JPG, WEBP, or SVG, up
          to 2 MB.
        </p>
        <div className="flex items-center gap-4">
          {current ? (
            <span className="inline-flex items-center justify-center h-16 w-32 border bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current} alt="Event logo" className="max-h-full max-w-full object-contain" />
            </span>
          ) : (
            <span className="inline-flex items-center justify-center h-16 w-32 border border-dashed text-xs text-muted-foreground">
              No logo
            </span>
          )}
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="block px-3 py-1.5 border text-sm hover:bg-[color:var(--surface-2)] disabled:opacity-50"
            >
              {busy ? "Uploading…" : current ? "Replace logo" : "Upload logo"}
            </button>
            {current && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="block px-3 py-1.5 border border-destructive text-destructive text-sm hover:bg-[color:var(--surface-2)] disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        {err && <p className="text-xs text-destructive mt-2">{err}</p>}
      </CardContent>
    </Card>
  );
}
