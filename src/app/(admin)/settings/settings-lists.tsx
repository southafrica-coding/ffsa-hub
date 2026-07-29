"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, ChevronUp, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { ListOption } from "@/services/list-options";

// Friendly titles + descriptions for each editable list.
// NOTE: departments are managed in the Ministry tab (staff_ministries), not
// here — the profile Department dropdown is sourced live from there.
const LIST_META: { key: string; title: string; blurb: string }[] = [
  { key: "insurance_provider", title: "Health insurance providers", blurb: "Schemes shown in the insurance dropdown. “Other” stays built-in." },
  { key: "gender", title: "Gender", blurb: "Options for the gender field." },
  { key: "relationship", title: "Emergency-contact relationship", blurb: "How an emergency contact relates to the person." },
];

export function SettingsLists({
  lists,
}: {
  lists: Record<string, ListOption[]>;
}) {
  return (
    <div className="space-y-8">
      {LIST_META.map((meta) => (
        <ListSection
          key={meta.key}
          listKey={meta.key}
          title={meta.title}
          blurb={meta.blurb}
          options={lists[meta.key] ?? []}
        />
      ))}
    </div>
  );
}

function ListSection({
  listKey,
  title,
  blurb,
  options,
}: {
  listKey: string;
  title: string;
  blurb: string;
  options: ListOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function call(url: string, method: string, body?: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast.error(b.error ?? "Something went wrong");
      return false;
    }
    router.refresh();
    return true;
  }

  async function add() {
    const label = newLabel.trim();
    if (!label) return;
    if (await call("/api/admin/list-options", "POST", { list_key: listKey, label })) {
      setNewLabel("");
      toast.success("Option added");
    }
  }

  async function rename(id: string) {
    const label = (drafts[id] ?? "").trim();
    if (!label) return;
    if (await call(`/api/admin/list-options/${id}`, "PATCH", { label })) {
      toast.success("Renamed");
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
    }
  }

  async function toggleActive(o: ListOption) {
    await call(`/api/admin/list-options/${o.id}`, "PATCH", { is_active: !o.is_active });
  }

  async function remove(o: ListOption) {
    if (o.is_system) return;
    await call(`/api/admin/list-options/${o.id}`, "DELETE");
  }

  // Swap sort_order with the neighbour in the given direction.
  async function move(index: number, dir: -1 | 1) {
    const a = options[index];
    const b = options[index + dir];
    if (!a || !b) return;
    setBusy(true);
    const [r1, r2] = await Promise.all([
      fetch(`/api/admin/list-options/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: b.sort_order }),
      }),
      fetch(`/api/admin/list-options/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: a.sort_order }),
      }),
    ]);
    setBusy(false);
    if (!r1.ok || !r2.ok) {
      toast.error("Could not reorder");
      return;
    }
    router.refresh();
  }

  return (
    <section className="rounded-xl border p-4 space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{blurb}</p>
      </div>

      <div className="space-y-2">
        {options.map((o, i) => {
          const draft = drafts[o.id];
          const changed = draft !== undefined && draft.trim() !== o.label;
          return (
            <div
              key={o.id}
              className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
            >
              <div className="flex flex-col">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-6"
                  disabled={busy || i === 0}
                  aria-label="Move up"
                  onClick={() => move(i, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-6"
                  disabled={busy || i === options.length - 1}
                  aria-label="Move down"
                  onClick={() => move(i, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>

              <Input
                value={draft ?? o.label}
                disabled={busy}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [o.id]: e.target.value }))
                }
                className={o.is_active ? "" : "opacity-60"}
              />

              {changed && (
                <Button
                  size="icon"
                  variant="outline"
                  disabled={busy}
                  aria-label="Save name"
                  onClick={() => rename(o.id)}
                >
                  <Check className="h-4 w-4" />
                </Button>
              )}

              {o.is_system && <Badge variant="outline">built-in</Badge>}

              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => toggleActive(o)}
              >
                {o.is_active ? "Active" : "Hidden"}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                disabled={busy || o.is_system}
                aria-label="Delete option"
                title={o.is_system ? "Built-in option — deactivate instead" : "Delete"}
                onClick={() => remove(o)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        {options.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No options yet.</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Input
          placeholder={`Add a ${title.toLowerCase().replace(/s$/, "")}…`}
          value={newLabel}
          disabled={busy}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <Button onClick={add} disabled={busy || !newLabel.trim()}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
    </section>
  );
}
