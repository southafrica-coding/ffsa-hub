"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PickerCategory = { id: string; name: string; slug: string; sort_order: number };

const NEW = "__new__";

/**
 * Category dropdown with "+ New category…" at the bottom. Picking it turns
 * the control into a name box; the new category is created for every team
 * and selected straight away.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  onCreated,
  placeholder = "Choose a category",
  className,
}: {
  categories: PickerCategory[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (category: PickerCategory) => void;
  placeholder?: string;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/finance/outreach/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Couldn't add that category");
        return;
      }
      onCreated(data.category);
      onChange(data.category.id);
      if (data.existed) toast.message(`"${data.category.name}" already exists — using it`);
      else toast.success(`Added "${data.category.name}"`);
      setAdding(false);
      setName("");
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (adding) {
    return (
      <div className={`flex gap-1.5 ${className ?? ""}`}>
        <Input
          autoFocus
          value={name}
          placeholder="New category name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
            if (e.key === "Escape") setAdding(false);
          }}
          className="h-9 min-w-0"
        />
        <Button type="button" size="sm" onClick={create} disabled={saving || !name.trim()}>
          {saving ? "…" : "Add"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
          ✕
        </Button>
      </div>
    );
  }

  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => (v === NEW ? setAdding(true) : onChange(v))}
    >
      <SelectTrigger className={`h-9 ${className ?? ""}`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {sorted.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={NEW} className="font-medium">
          + New category…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
