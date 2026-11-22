"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormAccessMode } from "@/lib/forms/schema";
import { ACCESS_MODE_LABELS } from "./describe";

const INPUT =
  "min-h-11 w-full border border-[color:var(--rule-strong)] bg-[color:var(--surface-1,#fff)] px-3 py-2 text-[15px] font-normal normal-case tracking-normal";
const BTN_PRIMARY =
  "inline-flex min-h-11 w-full items-center justify-center border border-ink bg-ink px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white hover:bg-[var(--ink-bg-hover)] disabled:opacity-50";

/** "New form": a name and who can fill it, then straight into the builder. */
export function NewFormButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [accessMode, setAccessMode] = useState<FormAccessMode>("public");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setErr("Give the form a name.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), access_mode: accessMode }),
    });
    if (!res.ok) {
      setBusy(false);
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setErr(data.message ?? data.error ?? "Couldn't create the form");
      return;
    }
    const { form } = (await res.json()) as { form: { id: string } };
    router.push(`/forms/${form.id}`);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={BTN_PRIMARY}>
        New form
      </button>
    );
  }

  return (
    <div className="space-y-3 border border-ink p-3.5">
      <label className="block">
        <span className="block">Form name</span>
        <input
          autoFocus
          aria-label="Form name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
          className={`${INPUT} mt-1.5`}
        />
      </label>
      <label className="block">
        <span className="block">Who can fill it in</span>
        <select
          aria-label="Who can fill it in"
          value={accessMode}
          onChange={(e) => setAccessMode(e.target.value as FormAccessMode)}
          className={`${INPUT} mt-1.5`}
        >
          <option value="public">{ACCESS_MODE_LABELS.public}</option>
          <option value="logged_in">{ACCESS_MODE_LABELS.logged_in}</option>
        </select>
      </label>
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="inline-flex min-h-11 flex-1 items-center justify-center border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone"
        >
          Cancel
        </button>
        <button type="button" onClick={create} disabled={busy} className={`${BTN_PRIMARY} flex-1`}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}
