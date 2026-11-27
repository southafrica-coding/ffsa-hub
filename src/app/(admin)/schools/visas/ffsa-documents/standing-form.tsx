"use client";

// One of FFSA's standing documents: edit its name and dates, upload or
// replace the file, open it, or add a new one. Global legal only; the
// routes and RLS check that again.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorLine, VisaButton, openStandingDocument } from "@/components/visas/visa-ui";

export interface StandingRow {
  id: string;
  label: string;
  description: string | null;
  certified_on: string | null;
  renew_months: number | null;
  expires_on: string | null;
  for_students: boolean;
  sort_order: number;
  is_active: boolean;
  has_file: boolean;
}

const INPUT = "min-h-11 w-full border border-rule-strong bg-white px-3 text-[14px] outline-none focus:border-ink";

async function send(url: string, method: string, body: BodyInit, json: boolean) {
  const res = await fetch(url, {
    method,
    headers: json ? { "Content-Type": "application/json" } : undefined,
    body,
  }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  return res && res.ok ? null : ((out.error as string | undefined) ?? "Something went wrong");
}

function Fields({ f, setF }: { f: Omit<StandingRow, "id" | "has_file">; setF: (f: Omit<StandingRow, "id" | "has_file">) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="mono-label">Name</span>
        <input value={f.label} maxLength={200} onChange={(e) => setF({ ...f, label: e.target.value })} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="mono-label">What it is</span>
        <input
          value={f.description ?? ""}
          maxLength={2000}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="mono-label">Certified on</span>
        <input type="date" value={f.certified_on ?? ""} onChange={(e) => setF({ ...f, certified_on: e.target.value || null })} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="mono-label">Re-certify every (months)</span>
        <input
          inputMode="numeric"
          value={f.renew_months?.toString() ?? ""}
          onChange={(e) => setF({ ...f, renew_months: e.target.value ? Number(e.target.value) : null })}
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="mono-label">Expires on (if it has its own expiry)</span>
        <input type="date" value={f.expires_on ?? ""} onChange={(e) => setF({ ...f, expires_on: e.target.value || null })} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="mono-label">Order in the list</span>
        <input
          inputMode="numeric"
          value={f.sort_order.toString()}
          onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) || 0 })}
          className={INPUT}
        />
      </label>
    </div>
  );
}

/** Edit, upload and open one document. */
export function StandingEdit({ doc }: { doc: StandingRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Omit<StandingRow, "id" | "has_file">>(doc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const err = await work();
    setBusy(false);
    if (err) return setError(err);
    router.refresh();
  }

  async function upload(picked: File) {
    const form = new FormData();
    form.append("file", picked);
    await run(() => send(`/api/visas/standing-documents/${doc.id}/file`, "POST", form, false));
    if (file.current) file.current.value = "";
  }

  const patch = (next: Partial<StandingRow>) =>
    run(() => send(`/api/visas/standing-documents/${doc.id}`, "PATCH", JSON.stringify({ ...f, ...next }), true));

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {doc.has_file && (
          <VisaButton tone="outline" onClick={() => void openStandingDocument(doc.id)}>
            Open
          </VisaButton>
        )}
        <VisaButton tone={doc.has_file ? "outline" : "solid"} disabled={busy} onClick={() => file.current?.click()}>
          {doc.has_file ? "Replace file" : "Upload file"}
        </VisaButton>
        <input
          ref={file}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
        />
        {doc.has_file && doc.is_active && (
          <VisaButton tone="outline" disabled={busy} onClick={() => void patch({ for_students: !doc.for_students })}>
            {doc.for_students ? "Stop giving to students" : "Give to students"}
          </VisaButton>
        )}
        {!open && (
          <VisaButton tone="outline" onClick={() => setOpen(true)}>
            Edit details
          </VisaButton>
        )}
      </div>
      {open && (
        <div className="mt-1 flex flex-col gap-3 border-t border-rule pt-3">
          <Fields f={f} setF={setF} />
          <label className="flex min-h-11 items-center gap-2 text-[14px]">
            <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />
            In use (untick to retire it)
          </label>
          <div className="flex flex-wrap gap-2">
            <VisaButton disabled={busy || !f.label.trim()} onClick={() => void patch({}).then(() => setOpen(false))}>
              Save
            </VisaButton>
            <VisaButton
              tone="outline"
              onClick={() => {
                setF(doc);
                setOpen(false);
              }}
            >
              Cancel
            </VisaButton>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/** Add a document to the list; the file goes up afterwards. */
export function StandingAdd() {
  const router = useRouter();
  const empty = {
    label: "",
    description: null,
    certified_on: null,
    renew_months: null,
    expires_on: null,
    for_students: false,
    sort_order: 100,
    is_active: true,
  };
  const [f, setF] = useState<Omit<StandingRow, "id" | "has_file">>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const err = await send("/api/visas/standing-documents", "POST", JSON.stringify(f), true);
    setBusy(false);
    if (err) return setError(err);
    setF(empty);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <Fields f={f} setF={setF} />
      <div>
        <VisaButton disabled={busy || !f.label.trim()} onClick={() => void add()}>
          Add document
        </VisaButton>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}
