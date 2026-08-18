"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ContactList = {
  added_at: string;
  contact_lists: {
    id: string;
    name: string;
    color: string | null;
  } | null;
};

type ListOption = {
  id: string;
  name: string;
};

export function ListsCard({
  contactId,
  contactLists,
  allLists,
}: {
  contactId: string;
  contactLists: ContactList[];
  allLists: ListOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"closed" | "existing" | "new">("closed");
  const [pickId, setPickId] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const heldIds = new Set(
    contactLists.map((cl) => cl.contact_lists?.id).filter(Boolean) as string[]
  );
  const available = allLists.filter((l) => !heldIds.has(l.id));

  async function addToList() {
    if (mode === "existing" && !pickId) {
      setErr("Pick a list.");
      return;
    }
    if (mode === "new" && !newName.trim()) {
      setErr("Type a list name.");
      return;
    }
    setBusy(true);
    setErr(null);
    const payload =
      mode === "existing" ? { listId: pickId } : { newListName: newName.trim() };
    const res = await fetch(`/api/contacts/${contactId}/lists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to add to list");
      return;
    }
    setMode("closed");
    setPickId("");
    setNewName("");
    router.refresh();
  }

  async function removeFromList(listId: string) {
    setBusy(true);
    const res = await fetch(`/api/contacts/${contactId}/lists/${listId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to remove from list");
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Lists</CardTitle>
        {mode === "closed" && (
          <button
            type="button"
            onClick={() => setMode(available.length > 0 ? "existing" : "new")}
            className="text-xs text-electric hover:underline"
          >
            + Add
          </button>
        )}
      </CardHeader>
      <CardContent>
        {contactLists.length === 0 ? (
          <p className="text-sm text-muted-foreground mb-3">Not in any list</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {contactLists.map((cl) => {
              if (!cl.contact_lists) return null;
              const list = cl.contact_lists;
              return (
                <span
                  key={list.id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 border font-medium bg-secondary"
                  title={`Added ${new Date(cl.added_at).toLocaleString()}`}
                >
                  <Link href={`/contacts/lists/${list.id}`} className="hover:underline">
                    {list.name}
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeFromList(list.id)}
                    disabled={busy}
                    className="opacity-60 hover:opacity-100"
                    aria-label="Remove from list"
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
                <input
                  type="radio"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
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
                <option value="">— pick a list —</option>
                {available.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New list name"
                className="w-full border text-sm px-2 py-1"
                disabled={busy}
              />
            )}

            {err && <p className="text-xs text-destructive">{err}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={addToList}
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
