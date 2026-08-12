"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TierWaiver } from "@/lib/ticketing/waivers";

// Per-tier signable-waiver editor, shown under each tier next to the
// per-ticket questions editor. The organizer uploads the actual form as a
// PDF, optionally adds instructions, and chooses which guardian/minor
// fields are required. At checkout the parent reads the uploaded PDF and
// signs once per ticket of this tier. Saving PATCHes ticket_types.waiver;
// the version auto-bumps whenever the content or document changes so a
// signed record always names the exact version agreed to.

const EMPTY: TierWaiver = {
  enabled: false,
  version: "1",
  title: "Waiver & Indemnity Form",
  body_markdown: "",
  document_path: null,
  document_name: null,
  require_minor_name: true,
  require_relationship: true,
};

export function TierWaiverEditor({
  eventId,
  ticketTypeId,
  ticketName,
  initialWaiver,
}: {
  eventId: string;
  ticketTypeId: string;
  ticketName: string;
  initialWaiver: TierWaiver | null;
}) {
  const router = useRouter();
  const initial = useMemo<TierWaiver>(
    () => ({ ...EMPTY, ...(initialWaiver ?? {}) }),
    [initialWaiver]
  );

  const [open, setOpen] = useState(false);
  const [w, setW] = useState<TierWaiver>(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = useMemo(
    () => JSON.stringify(w) !== JSON.stringify(initial),
    [w, initial]
  );
  const configured = !!initialWaiver?.enabled && !!initialWaiver?.document_path;

  function set<K extends keyof TierWaiver>(key: K, value: TierWaiver[K]) {
    setMsg(null);
    setW((prev) => ({ ...prev, [key]: value }));
  }

  async function upload(file: File) {
    if (file.type !== "application/pdf") {
      setErr("The waiver form must be a PDF.");
      return;
    }
    setUploading(true);
    setErr(null);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("ticket_type_id", ticketTypeId);
    const res = await fetch(`/api/events/${eventId}/waiver-document`, {
      method: "POST",
      body: fd,
    });
    setUploading(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Upload failed.");
      return;
    }
    const data = (await res.json()) as {
      document_path: string;
      document_name: string;
    };
    setW((prev) => ({
      ...prev,
      document_path: data.document_path,
      document_name: data.document_name,
      enabled: true,
    }));
  }

  async function save() {
    if (w.enabled && !w.document_path) {
      setErr("Upload the waiver PDF before enabling it.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    // Auto-bump the version when the signed content changes, so any
    // signature records the exact version they agreed to.
    const contentChanged =
      w.title !== initial.title ||
      w.body_markdown !== initial.body_markdown ||
      w.document_path !== initial.document_path;
    const version = contentChanged
      ? String((Number.parseInt(initial.version, 10) || 0) + 1)
      : w.version;
    const payload: TierWaiver = { ...w, version };
    const res = await fetch(
      `/api/events/${eventId}/ticket-types/${ticketTypeId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waiver: payload }),
      }
    );
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't save the waiver.");
      return;
    }
    setW(payload);
    setMsg("Saved.");
    router.refresh();
  }

  return (
    <div className="mt-2 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <span className="mr-1">{open ? "▾" : "▸"}</span>
        Signable waiver / form
        {configured && (
          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
            on
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-muted-foreground">
            Require a parent/guardian to read and sign a form for every{" "}
            <span className="font-medium">{ticketName}</span> ticket at
            checkout (e.g. a youth-camp indemnity form). Upload the form as a
            PDF; the signed record is stored per attendee.
          </p>

          {/* Document upload */}
          <div className="rounded border p-3 space-y-2 bg-gray-50">
            <p className="text-xs font-medium">Waiver document (PDF)</p>
            {w.document_path ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-emerald-700">
                  ✓ {w.document_name ?? "uploaded.pdf"}
                </span>
                <a
                  href={`/api/events/${eventId}/waiver-document?tier=${ticketTypeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  View
                </a>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="text-xs text-blue-600 hover:underline"
                  disabled={uploading}
                >
                  Replace
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="px-3 py-1 rounded border text-xs hover:bg-white disabled:text-gray-300"
              >
                {uploading ? "Uploading…" : "Upload PDF"}
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={w.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            Require this waiver to be signed at checkout
          </label>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Form title (shown to the buyer)
            </label>
            <input
              type="text"
              value={w.title}
              onChange={(e) => set("title", e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="e.g. Youth Camp Indemnity & Consent Form"
            />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Instructions (optional — shown above the signature)
            </label>
            <textarea
              value={w.body_markdown}
              onChange={(e) => set("body_markdown", e.target.value)}
              rows={2}
              className="w-full border rounded px-2 py-1.5 text-sm resize-none"
              placeholder="e.g. Please read the attached form carefully before signing."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={w.require_minor_name}
                onChange={(e) => set("require_minor_name", e.target.checked)}
              />
              Require the attendee&apos;s (minor&apos;s) full name
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={w.require_relationship}
                onChange={(e) => set("require_relationship", e.target.checked)}
              />
              Require the signer&apos;s relationship to the attendee
            </label>
          </div>

          {err && <p className="text-xs text-red-600">{err}</p>}
          {msg && !dirty && <p className="text-xs text-green-600">{msg}</p>}
          {dirty && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:bg-gray-300"
              >
                {busy ? "Saving…" : "Save waiver"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setW(initial);
                  setErr(null);
                  setMsg(null);
                }}
                disabled={busy}
                className="px-3 py-1 rounded border text-xs hover:bg-gray-50"
              >
                Discard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
