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
  currentLabelIds,
  labels,
}: {
  eventId: string;
  /** Every label the event applies. First entry is the primary. */
  currentLabelIds: string[];
  labels: Label[];
}) {
  const router = useRouter();
  // Local copy so a label created inline appears in the dropdown immediately,
  // before router.refresh() repopulates the server-fetched list.
  const [options, setOptions] = useState<Label[]>(labels);
  const [selected, setSelected] = useState<string[]>(currentLabelIds);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function save(next: string[]) {
    setSelected(next);
    setBusy(true);
    setErr(null);
    setSaved(false);
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_label_ids: next }),
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

  function addLabel(id: string) {
    if (id === CREATE_OPTION) {
      setCreating(true);
      setErr(null);
      setSaved(false);
      return;
    }
    if (!id || selected.includes(id)) return;
    setCreating(false);
    save([...selected, id]);
  }

  function removeLabel(id: string) {
    save(selected.filter((x) => x !== id));
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
    // Add it to this event's labels immediately (create & select).
    if (!selected.includes(created.id)) {
      await save([...selected, created.id]);
    } else {
      setBusy(false);
    }
  }

  function cancelCreate() {
    setCreating(false);
    setNewName("");
    setErr(null);
  }

  const chosen = selected
    .map((id) => options.find((l) => l.id === id))
    .filter(Boolean) as Label[];
  const available = options.filter((l) => !selected.includes(l.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Base labels</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-2">
          Applied to every contact who comes in through this event — anyone who
          submits a form for it and anyone who buys a ticket. The first label is
          the primary one, used as the default for new forms.
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
              className="border px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={createLabel}
              disabled={busy || !newName.trim()}
              className="text-sm px-3 py-1.5 border bg-primary text-primary-foreground disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={cancelCreate}
              disabled={busy}
              className="text-sm px-2 py-1.5 border text-muted-foreground"
            >
              Cancel
            </button>
            {busy && <span className="text-xs text-muted-foreground">Saving…</span>}
            {err && <span className="text-xs text-destructive">{err}</span>}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {chosen.length === 0 && (
                <span className="text-xs text-muted-foreground">No labels yet</span>
              )}
              {chosen.map((l, i) => {
                const c = getLabelColors(l);
                return (
                  <span
                    key={l.id}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 border font-medium"
                    style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
                  >
                    {l.name}
                    {i === 0 && <span className="opacity-70">· primary</span>}
                    <button
                      type="button"
                      onClick={() => removeLabel(l.id)}
                      disabled={busy}
                      aria-label={`Remove ${l.name}`}
                      className="ml-0.5 leading-none disabled:opacity-50"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <select
                value=""
                onChange={(e) => addLabel(e.target.value)}
                disabled={busy}
                className="border px-2 py-1.5 text-sm"
              >
                <option value="">+ Add a label…</option>
                {available.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value={CREATE_OPTION}>+ Create new label…</option>
              </select>
              {busy && <span className="text-xs text-muted-foreground">Saving…</span>}
              {saved && !busy && <span className="text-xs text-grass-text">Saved</span>}
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
