"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLabelColors } from "@/lib/label-color";

type Label = { id: string; slug: string; name: string; color: string | null };

// Sentinel select value that opens the inline "create new label" input.
const CREATE_OPTION = "__create__";

export function BaseLabelPicker({
  eventId,
  currentLabelId,
  labels,
}: {
  eventId: string;
  currentLabelId: string | null;
  labels: Label[];
}) {
  const router = useRouter();
  // Local copy so a label created inline appears in the dropdown immediately,
  // before router.refresh() repopulates the server-fetched list.
  const [options, setOptions] = useState<Label[]>(labels);
  const [value, setValue] = useState(currentLabelId ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function save(next: string) {
    setValue(next);
    setBusy(true);
    setErr(null);
    setSaved(false);
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_label_id: next || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to save");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  function onSelectChange(next: string) {
    if (next === CREATE_OPTION) {
      setCreating(true);
      setErr(null);
      setSaved(false);
      return;
    }
    setCreating(false);
    save(next);
  }

  async function createLabel() {
    const name = newName.trim();
    if (!name) {
      setErr("Enter a label name");
      return;
    }
    setBusy(true);
    setErr(null);
    setSaved(false);
    const res = await fetch(`/api/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setBusy(false);
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to create label");
      return;
    }
    const created = (await res.json()) as { id: string; name: string; slug: string };
    // Add to the dropdown if it's genuinely new (endpoint is idempotent on slug).
    setOptions((prev) =>
      prev.some((l) => l.id === created.id)
        ? prev
        : [...prev, { id: created.id, slug: created.slug, name: created.name, color: null }].sort(
            (a, b) => a.name.localeCompare(b.name)
          )
    );
    setCreating(false);
    setNewName("");
    // Apply it as this event's base label immediately (create & select).
    await save(created.id);
  }

  function cancelCreate() {
    setCreating(false);
    setNewName("");
    setErr(null);
  }

  const current = options.find((l) => l.id === value);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Base label</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-2">
          Applied to every contact who submits any form for this event.
        </p>
        {creating ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createLabel();
                } else if (e.key === "Escape") {
                  cancelCreate();
                }
              }}
              placeholder="New label name"
              disabled={busy}
              className="border rounded px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={createLabel}
              disabled={busy || !newName.trim()}
              className="text-sm px-3 py-1.5 rounded border bg-primary text-primary-foreground disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={cancelCreate}
              disabled={busy}
              className="text-sm px-2 py-1.5 rounded border text-muted-foreground"
            >
              Cancel
            </button>
            {busy && <span className="text-xs text-muted-foreground">Saving…</span>}
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <select
              value={value}
              onChange={(e) => onSelectChange(e.target.value)}
              disabled={busy}
              className="border rounded px-2 py-1.5 text-sm"
            >
              <option value="">— none —</option>
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value={CREATE_OPTION}>+ Create new label…</option>
            </select>
            {current && (
              <span
                className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-medium"
                style={(() => {
                  const c = getLabelColors(current);
                  return { backgroundColor: c.bg, color: c.text, borderColor: c.border };
                })()}
              >
                {current.name}
              </span>
            )}
            {busy && <span className="text-xs text-muted-foreground">Saving…</span>}
            {saved && !busy && <span className="text-xs text-green-600">Saved</span>}
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
