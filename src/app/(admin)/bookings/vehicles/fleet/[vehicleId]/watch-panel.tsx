"use client";

// Keep an eye on (the Fleet app's watchPanel, watchModal, saveWatch, del-watch): damage,
// recent repairs and flagged points, with add / edit / remove for the notes themselves.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SectionBar, StatusPill } from "@/components/ffsa";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { WatchNote } from "@/lib/fleet/rules/types";
import { ActionButton } from "../_components/ui";
import { fleetFetch } from "../_components/client-api";
import { F, field } from "./form-bits";
import { ATT_TONE, WATCH_KIND, type AttentionRow } from "./model";

export interface WatchPanelProps {
  vehicleId: string;
  watch: WatchNote[];
  rows: AttentionRow[];
  options: { name: string; items: { id: string; t: string }[] }[];
  weak: { name: string; list: [string, string][] } | null;
  canWrite: boolean;
  today: string;
}

const linkBtn = "min-h-11 font-mono text-[10px] font-bold uppercase tracking-[0.12em] underline";

export function WatchPanel({ vehicleId, watch, rows, options, weak, canWrite, today }: WatchPanelProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | "new" | null>(null);

  async function patchWatch(list: WatchNote[], ok: string) {
    await fleetFetch(`/api/vehicles/fleet/vehicles/${vehicleId}`, { method: "PATCH", body: { patch: { watch: list } } });
    toast.success(ok);
    router.refresh();
  }

  async function remove(idx: number) {
    if (!window.confirm("Remove this note? It will no longer show up at inspections.")) return;
    const list = watch.slice();
    list.splice(idx, 1);
    try {
      await patchWatch(list, "Removed.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section aria-label="Keep an eye on">
      <SectionBar title="Keep an eye on" />
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-3 md:px-8">
        <p className="max-w-2xl text-[13px] text-[#55524A]">
          Damage, recent repairs and anything marked Monitor or Fix now. These show up at the start of every weekly and monthly check, and on the step they belong to.
        </p>
        {canWrite && <ActionButton onClick={() => setEditing("new")}>Add</ActionButton>}
      </div>
      {rows.length ? (
        <ul className="divide-y divide-rule">
          {rows.map((a, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 gap-y-1 px-5 py-3 md:px-8">
              <span className="shrink-0">
                <StatusPill tone={ATT_TONE[a.k] || "quiet"}>{a.label}</StatusPill>
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <p className="break-words text-[14px]">{a.t}</p>
                {a.line && <p className="text-[12px] text-[#55524A]">{a.line}</p>}
              </div>
              {canWrite && a.src === "watch" && a.idx !== undefined && (
                <span className="flex gap-4">
                  <button type="button" className={linkBtn} onClick={() => setEditing(a.idx!)}>
                    Edit
                  </button>
                  <button type="button" className={linkBtn} onClick={() => remove(a.idx!)}>
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-3 text-[14px] text-[#55524A] md:px-8">
          Nothing recorded. Add damage, recent repairs or known problems so they get extra attention at every check.
        </p>
      )}
      {weak && weak.list.length > 0 && (
        <details className="border-t border-rule px-5 py-3 md:px-8">
          <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-medium">Known weak spots of the {weak.name}</summary>
          <dl className="grid gap-2 pb-2">
            {weak.list.map(([a, b]) => (
              <div key={a}>
                <dt className="text-[14px] font-medium">{a}</dt>
                <dd className="text-[13px] text-[#55524A]">{b}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {editing !== null && (
        <WatchDialog
          note={editing === "new" ? null : watch[editing] || null}
          options={options}
          today={today}
          onClose={() => setEditing(null)}
          onSave={async (entry) => {
            const list = watch.slice();
            if (editing === "new") list.unshift(entry);
            else list[editing] = entry;
            await patchWatch(list, "Saved.");
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function WatchDialog({
  note,
  options,
  today,
  onClose,
  onSave,
}: {
  note: WatchNote | null;
  options: WatchPanelProps["options"];
  today: string;
  onClose: () => void;
  onSave: (w: WatchNote) => Promise<void>;
}) {
  const [k, setK] = useState<string>(note ? note.k || "issue" : "damage");
  const [t, setT] = useState(note ? note.t : "");
  const [i, setI] = useState(note ? note.i || "" : "");
  const [d, setD] = useState(note ? note.d || "" : today);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!t.trim()) return toast.error("Say what to look out for.");
    setSaving(true);
    try {
      await onSave({ t: t.trim(), k: k as WatchNote["k"], i, d });
    } catch (e) {
      toast.error((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{note ? "Edit note" : "Keep an eye on"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <F label="What kind">
            <select className={field} value={k} onChange={(e) => setK(e.target.value)}>
              {Object.entries(WATCH_KIND).map(([key, l]) => (
                <option key={key} value={key}>
                  {l}
                </option>
              ))}
            </select>
          </F>
          <F label="What to look out for">
            <textarea
              className={field}
              rows={3}
              value={t}
              placeholder="e.g. Front bumper resprayed on 16 Oct 2026: check the paint isn’t cracking and the bumper is firm."
              onChange={(e) => setT(e.target.value)}
            />
          </F>
          <F label="Check it at this point">
            <select className={field} value={i} onChange={(e) => setI(e.target.value)}>
              <option value="">Not linked to one point</option>
              {options.map((sec) => (
                <optgroup key={sec.name} label={sec.name}>
                  {sec.items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.t}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </F>
          <F label="Since">
            <input className={field} type="date" value={d} onChange={(e) => setD(e.target.value)} />
          </F>
        </div>
        <DialogFooter className="gap-2">
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone="solid" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
