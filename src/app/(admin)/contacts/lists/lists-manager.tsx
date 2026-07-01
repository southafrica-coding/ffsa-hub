"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Users } from "lucide-react";

type ListItem = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  memberCount: number;
};

export function ListsManager({ lists }: { lists: ListItem[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createList() {
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Give the list a name.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/contacts/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, description: description.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to create list");
      return;
    }
    setName("");
    setDescription("");
    setCreating(false);
    router.refresh();
  }

  async function deleteList(id: string, listName: string) {
    if (
      !confirm(
        `Delete the list "${listName}"? This removes the list only — the contacts themselves are not deleted.`
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/contacts/lists/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to delete list");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Group contacts for a purpose — e.g. an event — without creating a label.
        </p>
        {!creating && (
          <Button size="sm" className="gap-1" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New list
          </Button>
        )}
      </div>

      {creating && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <Input
            placeholder="List name (e.g. Camp 2026 Attendees)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={createList} disabled={busy}>
              Create
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCreating(false);
                setErr(null);
                setName("");
                setDescription("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!creating && err && <p className="text-xs text-red-600">{err}</p>}

      {lists.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          No lists yet. Create one to start grouping contacts.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <div
              key={list.id}
              className="group relative rounded-lg border bg-card p-4 hover:border-foreground/30 transition-colors"
            >
              <Link href={`/contacts/lists/${list.id}`} className="block">
                <h3 className="font-medium pr-6">{list.name}</h3>
                {list.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {list.description}
                  </p>
                )}
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {list.memberCount} contact{list.memberCount === 1 ? "" : "s"}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => deleteList(list.id, list.name)}
                disabled={busy}
                aria-label="Delete list"
                className="absolute top-3 right-3 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-600 transition"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
