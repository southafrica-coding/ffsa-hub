"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { APPLICATION_STATE_LABEL, applicationState } from "@/lib/legal/status";
import {
  APPLICATION_STATUS_LABEL,
  APPLICATION_TONE,
  Button,
  DrawerSection,
  ErrorLine,
  Field,
  History,
  Select,
  TEXT_RESET,
  TextArea,
  TextInput,
  callApi,
  formatDate,
  type AppRow,
  type DocRow,
  type FolderRow,
  type Person,
} from "./legal-ui";

type Form = {
  folder_id: string;
  document_id: string;
  title: string;
  status: string;
  lodge_by: string;
  submitted_on: string;
  expected_on: string;
  reference_no: string;
  responsible_id: string;
  notes: string;
};

export type NewApplicationSeed = { folderId: string; documentId?: string; title?: string };

function toForm(app: AppRow | null, seed: NewApplicationSeed): Form {
  return {
    folder_id: app?.folder_id ?? seed.folderId,
    document_id: app?.document_id ?? seed.documentId ?? "",
    title: app?.title ?? seed.title ?? "",
    status: app?.status ?? "planned",
    lodge_by: app?.lodge_by ?? "",
    submitted_on: app?.submitted_on ?? "",
    expected_on: app?.expected_on ?? "",
    reference_no: app?.reference_no ?? "",
    responsible_id: app?.responsible_id ?? "",
    notes: app?.notes ?? "",
  };
}

function toBody(f: Form) {
  const n = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    folder_id: f.folder_id,
    document_id: n(f.document_id),
    title: f.title.trim(),
    status: f.status,
    lodge_by: n(f.lodge_by),
    submitted_on: n(f.submitted_on),
    expected_on: n(f.expected_on),
    reference_no: n(f.reference_no),
    responsible_id: n(f.responsible_id),
    notes: n(f.notes),
  };
}

export function ApplicationPanel({
  app,
  seed,
  folders,
  documents,
  people,
  today,
  onCreated,
  onOpenDocument,
}: {
  /** null = a new application, started from `seed`. */
  app: AppRow | null;
  seed: NewApplicationSeed;
  folders: FolderRow[];
  documents: DocRow[];
  people: Person[];
  today: string;
  onCreated: (id: string) => void;
  onOpenDocument: (id: string) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => toForm(app, seed));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState(0);

  // Reset only when a different application opens (see document-drawer).
  const appId = app?.id ?? null;
  useEffect(() => {
    setForm(toForm(app, seed));
    setError(null);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, seed.folderId, seed.documentId]);

  const set = (key: keyof Form) => (v: string) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: v }));
  };

  const state = app ? applicationState(app, today) : null;
  const folderDocs = documents.filter((d) => d.folder_id === form.folder_id);
  const linked = documents.find((d) => d.id === form.document_id) ?? null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (app) {
        await callApi("PATCH", `/api/legal/applications/${app.id}`, toBody(form));
        setSaved(true);
        setVersion((v) => v + 1);
      } else {
        const r = await callApi<{ application: { id: string } }>("POST", "/api/legal/applications", toBody(form));
        onCreated(r.application.id);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {app && state && (
        <div className="border-b border-ink bg-bone px-5 py-5 sm:px-6">
          <div className="mono-label mb-2">Application · {folders.find((f) => f.id === app.folder_id)?.name}</div>
          <h2 className="font-display text-[28px] font-black uppercase leading-[0.95]">{app.title}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill tone={APPLICATION_TONE[state]}>{APPLICATION_STATE_LABEL[state]}</StatusPill>
            <span className="font-mono text-[11px] tracking-[0.06em] text-[color:var(--text-secondary)]">
              {APPLICATION_STATUS_LABEL[app.status]}
              {app.lodge_by && state !== "closed" && !app.submitted_on ? ` · lodge by ${formatDate(app.lodge_by)}` : ""}
              {app.expected_on && state !== "closed" && app.submitted_on ? ` · expected ${formatDate(app.expected_on)}` : ""}
            </span>
          </div>
          {linked && (
            <button
              type="button"
              onClick={() => onOpenDocument(linked.id)}
              className="mt-3 min-h-11 font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline"
            >
              For: {linked.title}
            </button>
          )}
        </div>
      )}

      {app && <Checklist app={app} today={today} onChanged={() => setVersion((v) => v + 1)} />}

      <DrawerSection title={app ? "Details" : "New application"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="What is being applied for" className="sm:col-span-2">
            <TextInput value={form.title} onChange={set("title")} required maxLength={200} />
          </Field>
          <Field label="Folder">
            <Select value={form.folder_id} onChange={(v) => setForm((f) => ({ ...f, folder_id: v, document_id: "" }))}>
              {folders.filter((f) => !f.archived_at || f.id === form.folder_id).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="For document">
            <Select value={form.document_id} onChange={set("document_id")}>
              <option value="">None (a new document)</option>
              {folderDocs.map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={set("status")}>
              {Object.entries(APPLICATION_STATUS_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Responsible">
            <Select value={form.responsible_id} onChange={set("responsible_id")}>
              <option value="">{app ? "Nobody" : "Me"}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Lodge by" hint="The last day to submit.">
            <TextInput type="date" value={form.lodge_by} onChange={set("lodge_by")} />
          </Field>
          <Field label="Submitted">
            <TextInput type="date" value={form.submitted_on} onChange={set("submitted_on")} />
          </Field>
          <Field label="Expected back">
            <TextInput type="date" value={form.expected_on} onChange={set("expected_on")} />
          </Field>
          <Field label="Reference number">
            <TextInput value={form.reference_no} onChange={set("reference_no")} maxLength={120} autoComplete="off" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <TextArea value={form.notes} onChange={set("notes")} />
          </Field>
        </div>
        <div className="mt-4 space-y-3">
          <ErrorLine message={error} />
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving || !form.title.trim() || !form.folder_id}>
              {saving ? "Saving…" : app ? "Save changes" : "Start application"}
            </Button>
            {saved && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-grass-text">Saved</span>}
          </div>
        </div>
      </DrawerSection>

      {app && (
        <DrawerSection title="History">
          <History table="legal_applications" id={app.id} version={version} />
        </DrawerSection>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────
// CHECKLIST — one tap per step
// ────────────────────────────────────────────────────────────

function Checklist({ app, today, onChanged }: { app: AppRow; today: string; onChanged: () => void }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ticks show at once; the refresh brings the server's version.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const steps = [...app.steps].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  const done = steps.filter((s) => pending[s.id] ?? !!s.done_at).length;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function toggle(id: string, next: boolean) {
    setPending((p) => ({ ...p, [id]: next }));
    run(id, () => callApi("PATCH", `/api/legal/steps/${id}`, { done: next })).finally(() =>
      setPending((p) => {
        const { [id]: _drop, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
        return rest;
      })
    );
  }

  function add() {
    const text = label.trim();
    if (!text) return;
    const position = steps.length ? Math.max(...steps.map((s) => s.position)) + 1 : 0;
    run("add", async () => {
      await callApi("POST", `/api/legal/applications/${app.id}/steps`, { label: text, position });
      setLabel("");
    });
  }

  return (
    <DrawerSection title="Checklist" meta={steps.length ? `${done} of ${steps.length} done` : undefined}>
      <ErrorLine message={error} />
      {steps.length > 0 && (
        <ul className="mb-3 border-t border-rule">
          {steps.map((s) => {
            const checked = pending[s.id] ?? !!s.done_at;
            const late = !checked && s.due_on && s.due_on < today;
            return (
              <li key={s.id} className="flex items-center border-b border-rule">
                <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy === s.id}
                    onChange={(e) => toggle(s.id, e.target.checked)}
                    className="h-5 w-5 shrink-0 accent-[#0A0A0A]"
                  />
                  <span className={cn("min-w-0 text-[14px] text-ink", TEXT_RESET, checked && "text-[color:var(--text-tertiary)] line-through")}>
                    {s.label}
                    {s.due_on && (
                      <span className={cn("ml-2 font-mono text-[10px] tracking-[0.06em]", late ? "text-destructive" : "text-[color:var(--text-tertiary)]")}>
                        by {formatDate(s.due_on)}
                      </span>
                    )}
                  </span>
                </label>
                <button
                  type="button"
                  disabled={busy === s.id}
                  onClick={() => run(s.id, () => callApi("DELETE", `/api/legal/steps/${s.id}`))}
                  className="flex h-11 w-11 shrink-0 items-center justify-center text-[color:var(--text-tertiary)] hover:text-destructive"
                  aria-label={`Remove step: ${s.label}`}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add a step, e.g. Certified copy of ID"
          maxLength={200}
          className={`block min-h-11 min-w-0 flex-1 ${TEXT_RESET}`}
          aria-label="New step"
        />
        <Button type="submit" tone="outline" disabled={busy === "add" || !label.trim()}>
          Add
        </Button>
      </form>
    </DrawerSection>
  );
}
