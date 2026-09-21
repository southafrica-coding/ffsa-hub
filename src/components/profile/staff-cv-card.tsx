"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CV_ENTRY_CATEGORIES, type CvEntryCategory } from "@/lib/users/cv-entry-types";

export type CvEntry = {
  id: string;
  user_id: string;
  category: CvEntryCategory;
  title: string;
  description: string | null;
  added_by_role: "self" | "leadership";
};

export type CvViewer = {
  id: string;
  isAdmin: boolean;
  isLeadership: boolean;
};

// Mirrors src/lib/auth/check-cv-access.ts — kept in sync by hand since one
// side runs on the server (source of truth, re-checked by every API route)
// and this side only decides which controls to show.
function canManageEntry(entry: CvEntry, viewer: CvViewer): boolean {
  if (viewer.isAdmin) return true;
  return entry.added_by_role === "self" ? entry.user_id === viewer.id : viewer.isLeadership;
}

export function StaffCvCard({
  targetUserId,
  viewer,
  initialEssenceStatement,
  initialEntries,
}: {
  targetUserId: string;
  viewer: CvViewer;
  initialEssenceStatement: string;
  initialEntries: CvEntry[];
}) {
  const router = useRouter();
  const [essence, setEssence] = useState(initialEssenceStatement);
  const [savedEssence, setSavedEssence] = useState(initialEssenceStatement);
  const [savingEssence, setSavingEssence] = useState(false);
  const [essenceError, setEssenceError] = useState<string | null>(null);
  const [entries, setEntries] = useState<CvEntry[]>(initialEntries);
  const [adding, setAdding] = useState<{ category: CvEntryCategory; scope: "self" | "leadership" } | null>(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canEditEssence = viewer.id === targetUserId || viewer.isAdmin;
  const canAddSelf = viewer.id === targetUserId || viewer.isAdmin;
  const canAddLeadership = viewer.isLeadership || viewer.isAdmin;

  async function saveEssence() {
    setSavingEssence(true);
    setEssenceError(null);
    const res = await fetch("/api/profile/cv", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: targetUserId, essence_statement: essence }),
    });
    setSavingEssence(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setEssenceError(b.error ?? "Could not save.");
      return;
    }
    setSavedEssence(essence);
    router.refresh();
  }

  function beginAdd(category: CvEntryCategory, scope: "self" | "leadership") {
    setAdding({ category, scope });
    setEditingId(null);
    setDraftTitle("");
    setDraftDescription("");
    setFormError(null);
  }

  function beginEdit(entry: CvEntry) {
    setEditingId(entry.id);
    setAdding(null);
    setDraftTitle(entry.title);
    setDraftDescription(entry.description ?? "");
    setFormError(null);
  }

  function cancelForm() {
    setAdding(null);
    setEditingId(null);
    setFormError(null);
  }

  async function submitAdd() {
    if (!adding) return;
    if (!draftTitle.trim()) {
      setFormError("Please enter a title.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const res = await fetch("/api/staff-cv/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: targetUserId,
        category: adding.category,
        title: draftTitle.trim(),
        description: draftDescription.trim(),
        scope: adding.scope,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setFormError(json.error ?? "Could not save.");
      return;
    }
    setEntries((prev) => [...prev, json.entry as CvEntry]);
    setAdding(null);
  }

  async function submitEdit() {
    if (!editingId) return;
    if (!draftTitle.trim()) {
      setFormError("Please enter a title.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const res = await fetch(`/api/staff-cv/entries/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: draftTitle.trim(), description: draftDescription.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setFormError(json.error ?? "Could not save.");
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === editingId ? (json.entry as CvEntry) : e)));
    setEditingId(null);
  }

  async function removeEntry(id: string) {
    setBusy(true);
    setFormError(null);
    const res = await fetch(`/api/staff-cv/entries/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setFormError(json.error ?? "Could not remove this entry.");
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function renderForm(placeholder: string) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border p-3">
        <Input
          placeholder={placeholder}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          autoFocus
        />
        <Textarea
          placeholder="Details (optional)"
          value={draftDescription}
          onChange={(e) => setDraftDescription(e.target.value)}
        />
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={adding ? submitAdd : submitEdit}
          >
            {busy ? "Saving…" : editingId ? "Save" : "Add"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancelForm}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-xl border p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Essence statement
        </h3>
        {canEditEssence ? (
          <div className="space-y-2">
            <Textarea
              placeholder="A short statement of who you are and what drives you…"
              value={essence}
              onChange={(e) => setEssence(e.target.value)}
              rows={3}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={savingEssence || essence === savedEssence}
                onClick={saveEssence}
              >
                {savingEssence ? "Saving…" : "Save"}
              </Button>
            </div>
            {essenceError && <p className="text-sm text-destructive">{essenceError}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{savedEssence || "No essence statement yet."}</p>
        )}
      </section>

      {CV_ENTRY_CATEGORIES.map((cat) => {
        const rows = entries.filter((e) => e.category === cat.value);
        const isAddingHere = adding?.category === cat.value;
        return (
          <section key={cat.value} className="space-y-2 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {cat.label}
                </h3>
                <p className="text-xs text-muted-foreground">{cat.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canAddSelf && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => beginAdd(cat.value, "self")}
                  >
                    <Plus className="mr-1 h-4 w-4" /> {cat.addLabel}
                  </Button>
                )}
                {canAddLeadership && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => beginAdd(cat.value, "leadership")}
                  >
                    <Users className="mr-1 h-4 w-4" /> Add as leadership
                  </Button>
                )}
              </div>
            </div>

            {rows.length === 0 && !isAddingHere ? (
              <p className="text-sm text-muted-foreground">Nothing here yet.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((entry) =>
                  editingId === entry.id ? (
                    <li key={entry.id}>{renderForm(cat.placeholder)}</li>
                  ) : (
                    <li
                      key={entry.id}
                      className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{entry.title}</span>
                          {entry.added_by_role === "leadership" && (
                            <Badge variant="secondary">Added by leadership</Badge>
                          )}
                        </div>
                        {entry.description && (
                          <p className="mt-0.5 text-sm text-muted-foreground">{entry.description}</p>
                        )}
                      </div>
                      {canManageEntry(entry, viewer) && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Edit"
                            onClick={() => beginEdit(entry)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Remove"
                            disabled={busy}
                            onClick={() => removeEntry(entry.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                )}
              </ul>
            )}

            {isAddingHere && renderForm(cat.placeholder)}
          </section>
        );
      })}
    </div>
  );
}
