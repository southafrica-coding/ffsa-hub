"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getLabelColors } from "@/lib/label-color";

type ContactLabel = {
  added_at: string;
  added_via: string;
  labels: {
    id: string;
    slug: string;
    name: string;
    category: string | null;
    color: string | null;
  } | null;
};

type Label = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
};

export function LabelsCard({
  contactId,
  contactLabels,
  allLabels,
}: {
  contactId: string;
  contactLabels: ContactLabel[];
  allLabels: Label[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"closed" | "existing" | "new">("closed");
  const [pickId, setPickId] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const heldIds = new Set(contactLabels.map((cl) => cl.labels?.id).filter(Boolean) as string[]);
  const available = allLabels.filter((l) => !heldIds.has(l.id));

  async function addLabel() {
    setBusy(true);
    setErr(null);
    const payload =
      mode === "existing"
        ? { labelId: pickId }
        : { newLabelName: newName.trim() };
    if (mode === "existing" && !pickId) {
      setErr("Pick a label.");
      setBusy(false);
      return;
    }
    if (mode === "new" && !newName.trim()) {
      setErr("Type a label name.");
      setBusy(false);
      return;
    }
    const res = await fetch(`/api/contacts/${contactId}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to add label");
      return;
    }
    setMode("closed");
    setPickId("");
    setNewName("");
    router.refresh();
  }

  async function removeLabel(labelId: string) {
    if (!confirm("Remove this label? This will also unsubscribe the contact from the label's email stream.")) return;
    setBusy(true);
    const res = await fetch(`/api/contacts/${contactId}/labels/${labelId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to remove label");
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Labels</CardTitle>
        {mode === "closed" && (
          <button
            type="button"
            onClick={() => setMode("existing")}
            className="text-xs text-electric hover:underline"
          >
            + Add
          </button>
        )}
      </CardHeader>
      <CardContent>
        {contactLabels.length === 0 ? (
          <p className="text-sm text-muted-foreground mb-3">No labels assigned</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {contactLabels.map((cl) => {
              if (!cl.labels) return null;
              const colors = getLabelColors(cl.labels);
              return (
                <span
                  key={cl.labels.id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 border font-medium"
                  style={{
                    backgroundColor: colors.bg,
                    color: colors.text,
                    borderColor: colors.border,
                  }}
                  title={`Added ${new Date(cl.added_at).toLocaleString()} via ${cl.added_via}`}
                >
                  {cl.labels.name}
                  <button
                    type="button"
                    onClick={() => removeLabel(cl.labels!.id)}
                    disabled={busy}
                    className="opacity-60 hover:opacity-100"
                    aria-label="Remove label"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {mode !== "closed" && (
          <div className="border-t pt-3 space-y-2">
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={mode === "existing"}
                  onChange={() => setMode("existing")}
                  disabled={available.length === 0}
                />
                Pick existing
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
                Create new
              </label>
            </div>

            {mode === "existing" ? (
              <select
                value={pickId}
                onChange={(e) => setPickId(e.target.value)}
                className="w-full border text-sm px-2 py-1"
                disabled={busy}
              >
                <option value="">— pick a label —</option>
                {available.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.category ? ` (${l.category})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New label name"
                className="w-full border text-sm px-2 py-1"
                disabled={busy}
              />
            )}

            {err && <p className="text-xs text-destructive">{err}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={addLabel}
                disabled={busy}
                className="px-3 py-1 bg-ink text-white text-xs hover:bg-ink disabled:bg-bone-3"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("closed");
                  setErr(null);
                }}
                disabled={busy}
                className="px-3 py-1 border text-xs hover:bg-bone"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
