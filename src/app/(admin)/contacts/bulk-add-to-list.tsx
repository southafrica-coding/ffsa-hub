"use client";

// Bulk "add the selected people to a list". Lifted verbatim out of
// contacts-list.tsx when the directory was recomposed onto frame 35a, so both
// the old list and the new directory share one implementation instead of the
// behaviour being duplicated or lost. Logic unchanged; only the wrapper's
// styling was squared off to match the system.

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BulkAddToList({
  lists,
  selectedIds,
  onClear,
  onDone,
}: {
  lists: Array<{ id: string; name: string }>;
  selectedIds: string[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [pickId, setPickId] = useState("");
  const [newName, setNewName] = useState("");
  const [creatingNew, setCreatingNew] = useState(lists.length === 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addToList() {
    setErr(null);
    let listId = pickId;

    if (creatingNew) {
      const name = newName.trim();
      if (!name) {
        setErr("Name the new list.");
        return;
      }
      setBusy(true);
      const res = await fetch("/api/contacts/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setBusy(false);
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(data.error ?? "Failed to create list");
        return;
      }
      const data = (await res.json()) as { list: { id: string } };
      listId = data.list.id;
    } else if (!listId) {
      setErr("Pick a list.");
      return;
    }

    setBusy(true);
    const res = await fetch(`/api/contacts/lists/${listId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: selectedIds }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to add to list");
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border border-rule-strong bg-bone px-4 py-3">
      <span className="text-sm font-medium">
        {selectedIds.length} selected
      </span>

      {creatingNew ? (
        <Input
          placeholder="New list name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={busy}
          className="h-9 w-56"
          autoFocus
        />
      ) : (
        <Select value={pickId} onValueChange={setPickId}>
          <SelectTrigger className="h-9 w-56">
            <SelectValue placeholder="Add to list…" />
          </SelectTrigger>
          <SelectContent>
            {lists.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {lists.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setCreatingNew((v) => !v);
            setErr(null);
          }}
          className="text-xs text-ink underline underline-offset-2"
        >
          {creatingNew ? "Pick existing" : "Create new"}
        </button>
      )}

      <Button size="sm" onClick={addToList} disabled={busy}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
        Clear
      </Button>

      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
