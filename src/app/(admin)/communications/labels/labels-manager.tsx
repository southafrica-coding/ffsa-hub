"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionBar, StatusPill } from "@/components/ffsa";
import { LABEL_PALETTE, getLabelColors } from "@/lib/label-color";

export type LabelRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  color: string | null;
  is_preset: boolean;
  is_active: boolean;
};

function sortLabels(list: LabelRow[]): LabelRow[] {
  return [...list].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function LabelsManager({
  initialLabels,
  counts,
}: {
  initialLabels: LabelRow[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [labels, setLabels] = useState<LabelRow[]>(sortLabels(initialLabels));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [recolorId, setRecolorId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<LabelRow | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const activeCount = labels.filter((l) => l.is_active).length;

  function applyUpdate(updated: LabelRow) {
    setLabels((list) =>
      sortLabels(list.map((l) => (l.id === updated.id ? updated : l)))
    );
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setErr(null);
    setMsg(null);
    setBusyId(id);
    const res = await fetch(`/api/labels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(d.error ?? "Update failed");
      return null;
    }
    const data = (await res.json()) as { label: LabelRow };
    applyUpdate(data.label);
    router.refresh();
    return data.label;
  }

  function startEdit(l: LabelRow) {
    setEditingId(l.id);
    setEditName(l.name);
    setErr(null);
    setMsg(null);
  }

  async function saveRename(id: string) {
    if (!editName.trim()) {
      setErr("Label name cannot be empty");
      return;
    }
    const updated = await patch(id, { name: editName });
    if (updated) {
      setEditingId(null);
      setMsg("Label renamed.");
    }
  }

  async function recolor(id: string, color: string) {
    setRecolorId(null);
    const updated = await patch(id, { color });
    if (updated) setMsg("Colour updated.");
  }

  async function toggleActive(l: LabelRow) {
    const updated = await patch(l.id, { is_active: !l.is_active });
    if (updated) {
      setMsg(
        updated.is_active
          ? `“${updated.name}” is visible again.`
          : `“${updated.name}” hidden — it won't appear in pickers or the campaign composer.`
      );
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setDeleteErr(null);
    setDeleting(true);
    const res = await fetch(`/api/labels/${deleteTarget.id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setDeleteErr(d.error ?? "Delete failed");
      return;
    }
    setLabels((list) => list.filter((l) => l.id !== deleteTarget.id));
    setMsg(`“${deleteTarget.name}” deleted.`);
    setDeleteTarget(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-[color:var(--green-text)]">{msg}</p>}

      <div className="border border-ink bg-white">
        <SectionBar
          title="Labels"
          meta={`${activeCount} active${
            labels.length > activeCount
              ? ` · ${labels.length - activeCount} hidden`
              : ""
          }`}
        />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labels.map((l) => {
                const colors = getLabelColors(l);
                const isEditing = editingId === l.id;
                const busy = busyId === l.id;
                const count = counts[l.id] ?? 0;
                return (
                  <TableRow key={l.id} className={l.is_active ? "" : "opacity-50"}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Popover
                          open={recolorId === l.id}
                          onOpenChange={(o) => setRecolorId(o ? l.id : null)}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              aria-label="Change colour"
                              disabled={busy}
                              className="h-5 w-5 flex-shrink-0 border"
                              style={{
                                backgroundColor: colors.bg,
                                borderColor: colors.border,
                              }}
                            />
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-2">
                            <div className="grid grid-cols-8 gap-1.5">
                              {LABEL_PALETTE.map((p) => (
                                <button
                                  key={p.bg}
                                  type="button"
                                  aria-label={`Colour ${p.bg}`}
                                  onClick={() => recolor(l.id, p.bg)}
                                  className="h-5 w-5 border"
                                  style={{
                                    backgroundColor: p.bg,
                                    borderColor: p.border,
                                  }}
                                />
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>

                        {isEditing ? (
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveRename(l.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                        ) : (
                          <span className="text-sm font-medium">{l.name}</span>
                        )}
                        {l.is_preset && !isEditing && (
                          <span className="mono-label">preset</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-[color:var(--text-secondary)]">
                      {l.category || "—"}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {count}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={l.is_active ? "good" : "quiet"}>
                        {l.is_active ? "Active" : "Hidden"}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {isEditing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingId(null)}
                            disabled={busy}
                            className="h-7 px-2 text-xs"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveRename(l.id)}
                            disabled={busy}
                            className="h-7 px-2 text-xs"
                          >
                            {busy ? "…" : "Save"}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(l)}
                            disabled={busy}
                            className="h-7 px-2 text-xs"
                          >
                            Rename
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleActive(l)}
                            disabled={busy}
                            className={`h-7 px-2 text-xs ${
                              l.is_active
                                ? "text-[color:var(--amber)]"
                                : "text-[color:var(--green-text)]"
                            }`}
                          >
                            {l.is_active ? "Hide" : "Unhide"}
                          </Button>
                          {!l.is_preset && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setDeleteTarget(l);
                                setDeleteErr(null);
                              }}
                              disabled={busy}
                              className="h-7 px-2 text-xs text-destructive"
                            >
                              Delete
                            </Button>
                          )}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {labels.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-xs tracking-[0.05em] text-[color:var(--text-tertiary)]"
                  >
                    No labels yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteErr(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              This permanently removes the label
              {deleteTarget && (counts[deleteTarget.id] ?? 0) > 0 ? (
                <>
                  {" "}
                  and detaches it from{" "}
                  <strong>
                    {counts[deleteTarget.id]}{" "}
                    {counts[deleteTarget.id] === 1 ? "contact" : "contacts"}
                  </strong>
                </>
              ) : null}
              . This can&apos;t be undone. To keep the history, hide it instead.
            </DialogDescription>
          </DialogHeader>
          {deleteErr && <p className="text-sm text-destructive">{deleteErr}</p>}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteErr(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={doDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
