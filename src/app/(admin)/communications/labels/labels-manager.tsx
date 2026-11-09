"use client";

import { useState, useSyncExternalStore } from "react";
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

function subscribePhone(onStoreChange: () => void) {
  const mq = window.matchMedia("(max-width: 767px)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function usePhoneLayout() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false
  );
}

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
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const phone = usePhoneLayout();
  // Pick up server fields (the assigned colour, a rename from refresh) once
  // the in-progress edit is closed.
  const serverStamp = initialLabels
    .map((l) => `${l.id}:${l.color ?? ""}:${l.name}:${l.is_active ? 1 : 0}`)
    .join("|");
  const [seenStamp, setSeenStamp] = useState(serverStamp);
  if (seenStamp !== serverStamp && editingId === null && !creating) {
    setLabels(sortLabels(initialLabels));
    setSeenStamp(serverStamp);
  }

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

  async function createLabel() {
    const name = newName.trim();
    if (!name) {
      setErr("Give the label a name.");
      setMsg(null);
      return;
    }
    setErr(null);
    setMsg(null);
    setCreating(true);
    const res = await fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setCreating(false);
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      slug?: string;
      error?: string;
    };
    if (!res.ok || !data.id || !data.name || !data.slug) {
      setErr(data.error ?? "Could not create label");
      return;
    }
    const existed = labels.some((l) => l.id === data.id);
    if (!existed) {
      setLabels((list) =>
        sortLabels([
          ...list,
          {
            id: data.id!,
            slug: data.slug!,
            name: data.name!,
            description: null,
            category: null,
            color: null,
            is_preset: false,
            is_active: true,
          },
        ])
      );
    }
    setNewName("");
    setMsg(
      existed ? `“${data.name}” is already a label.` : `“${data.name}” created.`
    );
    router.refresh();
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

  function labelRowProps(l: LabelRow) {
    return {
      label: l,
      count: counts[l.id] ?? 0,
      editing: editingId === l.id,
      editName,
      busy: busyId === l.id,
      recolorOpen: recolorId === l.id,
      onRecolorOpen: (open: boolean) => setRecolorId(open ? l.id : null),
      onEditName: setEditName,
      onStartEdit: () => startEdit(l),
      onCancelEdit: () => setEditingId(null),
      onSave: () => void saveRename(l.id),
      onRecolor: (color: string) => void recolor(l.id, color),
      onToggle: () => void toggleActive(l),
      onDelete: () => {
        setDeleteTarget(l);
        setDeleteErr(null);
      },
    };
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
        <form
          className="flex flex-col gap-2 border-b border-rule bg-bone px-4 py-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void createLabel();
          }}
        >
          <label className="block min-w-0 flex-1">
            <span className="mono-label mb-1 block">New label</span>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Label name"
              disabled={creating}
            />
          </label>
          <Button
            type="submit"
            disabled={creating || !newName.trim()}
            className="min-h-11"
          >
            {creating ? "Creating…" : "Create label"}
          </Button>
        </form>
        {labels.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs tracking-[0.05em] text-[color:var(--text-tertiary)]">
            No labels yet. Create one above.
          </p>
        ) : phone ? (
          <div>
            {labels.map((l) => (
              <LabelEditorRow
                key={l.id}
                {...labelRowProps(l)}
                variant="card"
              />
            ))}
          </div>
        ) : (
        <div className="hidden md:block">
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
              {labels.map((l) => (
                <LabelEditorRow key={l.id} {...labelRowProps(l)} variant="row" />
              ))}
            </TableBody>
          </Table>
        </div>
        )}
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

function LabelEditorRow({
  label: l,
  count,
  variant,
  editing,
  editName,
  busy,
  recolorOpen,
  onRecolorOpen,
  onEditName,
  onStartEdit,
  onCancelEdit,
  onSave,
  onRecolor,
  onToggle,
  onDelete,
}: {
  label: LabelRow;
  count: number;
  variant: "card" | "row";
  editing: boolean;
  editName: string;
  busy: boolean;
  recolorOpen: boolean;
  onRecolorOpen: (open: boolean) => void;
  onEditName: (name: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onRecolor: (color: string) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const colors = getLabelColors(l);
  const btn =
    variant === "card" ? "min-h-11 px-3 text-xs" : "h-7 px-2 text-xs";
  const identity = (
    <div className="flex min-w-0 items-center gap-2">
      <Popover open={recolorOpen} onOpenChange={onRecolorOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Change colour"
            disabled={busy}
            className={
              variant === "card"
                ? "h-11 w-11 flex-shrink-0 border"
                : "h-5 w-5 flex-shrink-0 border"
            }
            style={{ backgroundColor: colors.bg, borderColor: colors.border }}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2">
          <div className="grid grid-cols-8 gap-1.5">
            {LABEL_PALETTE.map((p) => (
              <button
                key={p.bg}
                type="button"
                aria-label={`Colour ${p.bg}`}
                onClick={() => onRecolor(p.bg)}
                className="h-11 w-11 border md:h-5 md:w-5"
                style={{ backgroundColor: p.bg, borderColor: p.border }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {editing ? (
        <Input
          value={editName}
          onChange={(e) => onEditName(e.target.value)}
          className="h-11 text-sm md:h-8"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancelEdit();
          }}
        />
      ) : (
        <span
          className={
            variant === "card"
              ? "font-display text-[20px] font-black uppercase leading-none"
              : "text-sm font-medium"
          }
        >
          {l.name}
        </span>
      )}
      {l.is_preset && !editing && <span className="mono-label">preset</span>}
    </div>
  );
  const actions = editing ? (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancelEdit}
        disabled={busy}
        className={btn}
      >
        Cancel
      </Button>
      <Button size="sm" onClick={onSave} disabled={busy} className={btn}>
        {busy ? "…" : "Save"}
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={onStartEdit}
        disabled={busy}
        className={btn}
      >
        Rename
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        disabled={busy}
        className={`${btn} ${
          l.is_active ? "text-[color:var(--amber)]" : "text-[color:var(--green-text)]"
        }`}
      >
        {l.is_active ? "Hide" : "Unhide"}
      </Button>
      {!l.is_preset && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={busy}
          className={`${btn} text-destructive`}
        >
          Delete
        </Button>
      )}
    </>
  );

  if (variant === "card") {
    return (
      <div
        className={`border-b border-rule px-4 py-3.5 last:border-b-0 ${
          l.is_active ? "" : "opacity-50"
        }`}
      >
        {identity}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-[color:var(--text-secondary)]">
            {l.category || "—"}
          </span>
          <span className="mono-label">
            {count} {count === 1 ? "contact" : "contacts"}
          </span>
          <StatusPill tone={l.is_active ? "good" : "quiet"}>
            {l.is_active ? "Active" : "Hidden"}
          </StatusPill>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
      </div>
    );
  }

  return (
    <TableRow className={l.is_active ? "" : "opacity-50"}>
      <TableCell>{identity}</TableCell>
      <TableCell className="text-sm text-[color:var(--text-secondary)]">
        {l.category || "—"}
      </TableCell>
      <TableCell className="tabular text-right text-sm">{count}</TableCell>
      <TableCell>
        <StatusPill tone={l.is_active ? "good" : "quiet"}>
          {l.is_active ? "Active" : "Hidden"}
        </StatusPill>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">{actions}</TableCell>
    </TableRow>
  );
}
