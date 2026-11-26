"use client";

// Visiting teams — the forms. Each posts to /api/operations/visiting-teams
// and refreshes the server page. Phone first: 44px targets, stacked at 390px.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ACTIVE_STAGES,
  ENDED_STAGES,
  STAGE_LABEL,
  type Stage,
} from "@/lib/operations/visiting-teams";
import { cn } from "@/lib/utils/cn";

export type Person = { id: string; name: string };

const field =
  "min-h-11 w-full border border-rule-strong bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-ink";
const label = "mono-label mb-1.5 block";

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function send(url: string, method: string, body: unknown, ok?: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
        return null;
      }
      if (ok) setDone(json.warning ?? ok);
      router.refresh();
      return json;
    } catch {
      setError("Couldn't reach the Hub");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, done, send };
}

const Msg = ({ error, done }: { error: string | null; done: string | null }) =>
  error ? (
    <p className="mt-2 text-[13px] text-destructive">{error}</p>
  ) : done ? (
    <p className="mt-2 text-[13px] text-grass-text">{done}</p>
  ) : null;

// ── The team's details ──────────────────────────────────────
type Field = { key: string; label: string; type?: "date" | "number" | "area"; wide?: boolean; hint?: string };

const DETAIL_FIELDS: Field[] = [
  { key: "name", label: "Team name" },
  { key: "sending_org", label: "Sending base, school or church" },
  { key: "dates_text", label: "Dates (rough is fine)", hint: "e.g. April 2027" },
  { key: "locations", label: "Locations in SA" },
  { key: "arrival_on", label: "Arrival", type: "date" },
  { key: "arrival_time", label: "Arrival time / flight" },
  { key: "departure_on", label: "Departure", type: "date" },
  { key: "departure_time", label: "Departure time / flight" },
  { key: "size_text", label: "Team size", hint: "e.g. 10–12" },
  { key: "size_count", label: "Number of people", type: "number" },
  { key: "contact_name", label: "Outreach leader(s)" },
  { key: "contact_role", label: "Their role" },
  { key: "contact_email", label: "Leader email" },
  { key: "contact_phone", label: "Leader phone" },
  { key: "vehicles", label: "Base vehicles" },
  { key: "rooms", label: "Rooms (Potch base)" },
  { key: "heart_vision", label: "Heart and vision", type: "area", wide: true },
  { key: "notes", label: "Notes", type: "area", wide: true },
];

type Values = Record<string, string>;

function toValues(team: Record<string, unknown>): Values {
  const v: Values = {};
  for (const f of DETAIL_FIELDS) v[f.key] = team[f.key] == null ? "" : String(team[f.key]);
  return v;
}

function Fields({ values, set, only }: { values: Values; set: (k: string, v: string) => void; only?: string[] }) {
  return (
    <>
      {DETAIL_FIELDS.filter((f) => !only || only.includes(f.key)).map((f) => (
        <label key={f.key} className={f.wide ? "md:col-span-2" : undefined}>
          <span className={label}>{f.label}</span>
          {f.type === "area" ? (
            <textarea className={cn(field, "min-h-20")} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} maxLength={4000} />
          ) : (
            <input
              className={field}
              type={f.type ?? "text"}
              min={f.type === "number" ? 1 : undefined}
              max={f.type === "number" ? 500 : undefined}
              value={values[f.key] ?? ""}
              placeholder={f.hint}
              onChange={(e) => set(f.key, e.target.value)}
              required={f.key === "name"}
              maxLength={f.type ? undefined : 400}
            />
          )}
        </label>
      ))}
    </>
  );
}

/** Every detail, editable. Only changed fields are sent, so the history stays clean. */
export function TeamDetailsForm({ teamId, team }: { teamId: string; team: Record<string, unknown> }) {
  const { busy, error, done, send } = useSend();
  const start = toValues(team);
  const [values, setValues] = useState<Values>(start);
  const changed = Object.keys(values).filter((k) => values[k] !== start[k]);

  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed.length) return;
        await send(`/api/operations/visiting-teams/${teamId}`, "PATCH", Object.fromEntries(changed.map((k) => [k, values[k]])), "Saved.");
      }}
    >
      <Fields values={values} set={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <Button type="submit" disabled={busy || !changed.length}>{busy ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}</Button>
        {changed.length > 0 && (
          <Button type="button" variant="outline" onClick={() => setValues(start)}>Undo</Button>
        )}
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

// ── Private details ─────────────────────────────────────────
const PRIVATE: { key: "members" | "dietary" | "medical"; label: string; hint: string }[] = [
  { key: "members", label: "Team members", hint: "Names and emails, married couples, children and ages" },
  { key: "dietary", label: "Dietary needs and allergies", hint: "Who, and what" },
  { key: "medical", label: "Medical", hint: "Conditions or concerns to be aware of" },
];

export function PrivateForm({ teamId, values: initial }: { teamId: string; values: Record<string, string | null> }) {
  const { busy, error, done, send } = useSend();
  const start = Object.fromEntries(PRIVATE.map((p) => [p.key, initial[p.key] ?? ""]));
  const [values, setValues] = useState<Record<string, string>>(start);
  const changed = PRIVATE.map((p) => p.key).filter((k) => values[k] !== start[k]);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed.length) return;
        await send(`/api/operations/visiting-teams/${teamId}`, "PATCH", Object.fromEntries(changed.map((k) => [k, values[k]])), "Saved.");
      }}
    >
      {PRIVATE.map((p) => (
        <label key={p.key}>
          <span className={label}>{p.label}</span>
          <textarea
            className={cn(field, "min-h-24")}
            placeholder={p.hint}
            value={values[p.key]}
            onChange={(e) => setValues((s) => ({ ...s, [p.key]: e.target.value }))}
            maxLength={8000}
          />
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !changed.length}>{busy ? "Saving…" : "Save"}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

// ── Stage ───────────────────────────────────────────────────
export function StageControl({ teamId, stage, suggest }: { teamId: string; stage: Stage; suggest: Stage | null }) {
  const { busy, error, send } = useSend();
  const move = (to: Stage) => send(`/api/operations/visiting-teams/${teamId}`, "PATCH", { stage: to });
  const btn = (s: Stage) => (
    <button
      key={s}
      type="button"
      disabled={busy || s === stage}
      onClick={() => move(s)}
      className={cn(
        "min-h-11 border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em]",
        s === stage ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink hover:border-ink"
      )}
    >
      {STAGE_LABEL[s]}
    </button>
  );
  return (
    <div className="grid gap-3">
      {suggest && (
        <div className="flex flex-wrap items-center gap-3 border-l-[3px] border-ink bg-bone px-4 py-3">
          <span className="text-[14px] text-ink">Everything for {STAGE_LABEL[stage]} is ticked.</span>
          <Button size="sm" disabled={busy} onClick={() => move(suggest)}>Move to {STAGE_LABEL[suggest]}</Button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">{ACTIVE_STAGES.map(btn)}</div>
      <div className="flex flex-wrap gap-1.5">{ENDED_STAGES.map(btn)}</div>
      <Msg error={error} done={null} />
    </div>
  );
}

// ── Host ────────────────────────────────────────────────────
export function HostControl({ teamId, hostId, people }: { teamId: string; hostId: string | null; people: Person[] }) {
  const { busy, error, done, send } = useSend();
  return (
    <div>
      <select
        className={field}
        value={hostId ?? ""}
        disabled={busy}
        onChange={(e) => send(`/api/operations/visiting-teams/${teamId}`, "PATCH", { host_user_id: e.target.value || null }, "Host changed.")}
      >
        <option value="">No host yet</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── One checklist step ──────────────────────────────────────
export function StepRow({
  teamId,
  step,
  dueText,
  late,
  doneBy,
}: {
  teamId: string;
  step: { id: string; label: string; done_at: string | null; note: string | null };
  dueText: string | null;
  late: boolean;
  doneBy: string | null;
}) {
  const { busy, error, send } = useSend();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(step.note ?? "");
  const done = !!step.done_at;
  const url = `/api/operations/visiting-teams/${teamId}/steps/${step.id}`;

  return (
    <li className="grid grid-cols-[44px_1fr] gap-x-2 px-5 py-2 md:px-8">
      <button
        type="button"
        aria-pressed={done}
        aria-label={done ? `Untick: ${step.label}` : `Tick: ${step.label}`}
        disabled={busy}
        onClick={() => send(url, "PATCH", { done: !done })}
        className="flex h-11 w-11 items-center justify-center"
      >
        <span className={cn("flex h-6 w-6 items-center justify-center border-2", done ? "border-ink bg-ink text-white" : "border-rule-strong bg-white")}>
          {done && <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" /></svg>}
        </span>
      </button>
      <div className="min-w-0 py-2.5">
        <div className={cn("text-[15px] leading-snug", done ? "text-[color:var(--text-tertiary)] line-through" : "text-ink")}>{step.label}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-[color:var(--text-tertiary)]">
          {!done && dueText && <span className={cn(late && "font-semibold text-amber")}>{dueText}</span>}
          {done && doneBy && <span>Ticked by {doneBy}</span>}
          {step.note && !editing && <span className="text-[color:var(--text-secondary)]">“{step.note}”</span>}
          {!editing && (
            <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setEditing(true)}>
              {step.note ? "Change note" : "Add a note"}
            </button>
          )}
        </div>
        {editing && (
          <form
            className="mt-2 flex flex-col gap-2 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await send(url, "PATCH", { note })) setEditing(false);
            }}
          >
            <input className={field} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>Save</Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        )}
        <Msg error={error} done={null} />
      </div>
    </li>
  );
}

// ── Add a team (lead only) ──────────────────────────────────
export function AddTeamForm({ people, me }: { people: Person[]; me: string }) {
  const router = useRouter();
  const { busy, error, send } = useSend();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [stage, setStage] = useState<Stage>("enquiry");
  const [host, setHost] = useState(me);

  if (!open) return <Button onClick={() => setOpen(true)}>Add a team</Button>;
  return (
    <form
      className="grid w-full gap-3 border border-ink bg-white p-4 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("/api/operations/visiting-teams", "POST", { ...values, stage, host_user_id: host });
        if (r?.id) router.push(`/operations/visiting-teams/${r.id}`);
      }}
    >
      <Fields
        values={values}
        set={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
        only={["name", "sending_org", "dates_text", "locations", "arrival_on", "departure_on", "size_text", "contact_name"]}
      />
      <label>
        <span className={label}>Stage</span>
        <select className={field} value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
          {[...ACTIVE_STAGES, ...ENDED_STAGES].map((s) => (
            <option key={s} value={s}>{STAGE_LABEL[s]}</option>
          ))}
        </select>
      </label>
      <label>
        <span className={label}>Host</span>
        <select className={field} value={host} onChange={(e) => setHost(e.target.value)}>
          {!people.some((p) => p.id === me) && <option value={me}>Me</option>}
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <p className="text-[13px] text-[color:var(--text-tertiary)] md:col-span-2">
        The rest (leader contact, rooms, vehicles, team members) can be filled in on the team&apos;s page as it comes in.
      </p>
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add the team"}</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <div className="md:col-span-2"><Msg error={error} done={null} /></div>
    </form>
  );
}
