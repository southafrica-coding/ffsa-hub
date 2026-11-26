"use client";

// Operations — the small forms. Each posts to /api/operations/* and
// refreshes the server page. Phone first: 44px targets, stacked at 390px.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AREAS, STATUS_LABEL, type ItemStatus } from "@/lib/operations/areas";
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
      if (ok) setDone(ok);
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

// ── Copy text (the WhatsApp version of a request) ──────────
export function CopyButton({ text, label: words = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      {copied ? "Copied" : words}
    </Button>
  );
}

// ── "Check Slack now" ───────────────────────────────────────
export function ImportButton() {
  const { busy, error, done, send } = useSend();
  return (
    <div>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          const r = await send("/api/operations/slack", "POST", { action: "import" });
          if (r) alert(r.imported ? `${r.imported} new request${r.imported === 1 ? "" : "s"} picked up.` : "Nothing new in Slack.");
        }}
      >
        {busy ? "Checking…" : "Check Slack now"}
      </Button>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── Add an item / a meeting task ────────────────────────────
export function AddItemForm({ people, defaultArea = "maintenance", via = "hub" }: { people: Person[]; defaultArea?: string; via?: "hub" | "meeting" }) {
  const { busy, error, done, send } = useSend();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ area: defaultArea, title: "", location: "", details: "", owner_user_id: "", due_on: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>{via === "meeting" ? "Add a task" : "Add an item"}</Button>
    );
  }
  return (
    <form
      className="grid gap-3 border border-ink bg-white p-4 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("/api/operations/items", "POST", { ...form, via }, "Added.");
        if (r) {
          setForm({ ...form, title: "", location: "", details: "", owner_user_id: "", due_on: "" });
          setOpen(false);
        }
      }}
    >
      <label className="md:col-span-2">
        <span className={label}>What needs doing</span>
        <input className={field} value={form.title} onChange={set("title")} required minLength={2} maxLength={200} autoFocus />
      </label>
      <label>
        <span className={label}>Area</span>
        <select className={field} value={form.area} onChange={set("area")}>
          {AREAS.map((a) => (
            <option key={a.key} value={a.key}>{a.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span className={label}>Where (optional)</span>
        <input className={field} value={form.location} onChange={set("location")} maxLength={120} />
      </label>
      <label>
        <span className={label}>Given to (optional)</span>
        <select className={field} value={form.owner_user_id} onChange={set("owner_user_id")}>
          <option value="">Nobody yet</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span className={label}>By (optional)</span>
        <input className={field} type="date" value={form.due_on} onChange={set("due_on")} />
      </label>
      <label className="md:col-span-2">
        <span className={label}>Details (optional)</span>
        <textarea className={cn(field, "min-h-20")} value={form.details} onChange={set("details")} maxLength={4000} />
      </label>
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <div className="md:col-span-2"><Msg error={error} done={done} /></div>
    </form>
  );
}

// ── Update one item (status, note, owner, date) ─────────────
const QUICK: ItemStatus[] = ["seen", "in_progress", "more_time", "done", "wont_do"];
// Maintenance uses three words (migration 405); Won't do stays for the Hub.
const MAINT_QUICK: [ItemStatus, string][] = [
  ["new", "Not started"],
  ["in_progress", "In progress"],
  ["done", "Finished"],
  ["wont_do", "Won't do"],
];

export function ItemUpdateForm({
  itemId,
  status,
  ownerUserId,
  dueOn,
  people,
  canAssign,
  area,
}: {
  itemId: string;
  area?: string;
  status: ItemStatus;
  ownerUserId: string | null;
  dueOn: string | null;
  people: Person[];
  canAssign: boolean;
}) {
  const { busy, error, done, send } = useSend();
  const [next, setNext] = useState<ItemStatus | null>(null);
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState(ownerUserId ?? "");
  const [due, setDue] = useState(dueOn ?? "");
  const needsNote = next === "more_time" || next === "wont_do";

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const body: Record<string, unknown> = { note: note || null };
        if (next) body.status = next;
        if (canAssign) {
          if ((owner || null) !== ownerUserId) body.owner_user_id = owner || null;
          if ((due || null) !== dueOn) body.due_on = due || null;
        }
        const r = await send(`/api/operations/items/${itemId}`, "PATCH", body, "Saved.");
        if (r) {
          setNext(null);
          setNote("");
        }
      }}
    >
      <div>
        <span className={label}>Where it&apos;s at</span>
        <div className="flex flex-wrap gap-1.5">
          {(area === "maintenance" ? MAINT_QUICK : QUICK.map((q): [ItemStatus, string] => [q, STATUS_LABEL[q]])).map(([s, words]) => (
            <button
              key={s}
              type="button"
              onClick={() => setNext(next === s ? null : s)}
              disabled={s === status || (area === "maintenance" && s === "new" && status === "seen")}
              className={cn(
                "min-h-11 border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] disabled:opacity-40",
                next === s ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink hover:border-ink"
              )}
            >
              {words}
            </button>
          ))}
        </div>
      </div>
      <label>
        <span className={label}>{needsNote ? "A note on why (the person who asked will see it)" : "Note (optional)"}</span>
        <textarea className={cn(field, "min-h-20")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} required={needsNote} />
      </label>
      {canAssign && (
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            <span className={label}>Given to</span>
            <select className={field} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Nobody yet</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>By</span>
            <input className={field} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
      )}
      <div>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

// ── Meeting row: hand it to someone, with a date ────────────
export function AssignRow({ itemId, ownerUserId, dueOn, people }: { itemId: string; ownerUserId: string | null; dueOn: string | null; people: Person[] }) {
  const { busy, error, done, send } = useSend();
  const [owner, setOwner] = useState(ownerUserId ?? "");
  const [due, setDue] = useState(dueOn ?? "");
  const changed = (owner || null) !== ownerUserId || (due || null) !== dueOn;
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className={cn(field, "sm:w-48")} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Given to">
          <option value="">Nobody yet</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input className={cn(field, "sm:w-40")} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="By" />
        <Button
          variant={changed ? "default" : "outline"}
          disabled={busy || !changed}
          onClick={() =>
            send(`/api/operations/items/${itemId}`, "PATCH", { owner_user_id: owner || null, due_on: due || null, via: "meeting" }, "Saved — they'll get a message.")
          }
        >
          {busy ? "…" : "Save"}
        </Button>
      </div>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── After the meeting ───────────────────────────────────────
export function RecapButton() {
  const { busy, error, done, send } = useSend();
  return (
    <div>
      <Button disabled={busy} onClick={() => send("/api/operations/slack", "POST", { action: "recap" }, "Recap posted to the ops channel.")}>
        {busy ? "Posting…" : "Post the recap to Slack"}
      </Button>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── Settings (admins) ───────────────────────────────────────
export type MaintenanceSettings = {
  button_channel: string;
  followup_channel: string;
  status_user_ids: string[];
  rules: string;
  hours_notice: string;
  /** Crew hours by weekday ("0" = Sunday); a day left out is closed. */
  hours: Record<string, { open: string; close: string }>;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function SettingsForm({
  initial,
  maintenance: maintInitial,
  slackPeople,
}: {
  initial: { maintenance_intake_channel: string | null; ops_channel: string | null; area_channels: Record<string, string> };
  maintenance: MaintenanceSettings;
  /** Hub users with Slack linked: who can be allowed to set statuses. */
  slackPeople: Person[];
}) {
  const { busy, error, done, send } = useSend();
  const [intake, setIntake] = useState(initial.maintenance_intake_channel ?? "");
  const [ops, setOps] = useState(initial.ops_channel ?? "");
  const [areas, setAreas] = useState<Record<string, string>>(initial.area_channels ?? {});
  const [m, setM] = useState<MaintenanceSettings>(maintInitial);
  const [adding, setAdding] = useState("");
  const set = <K extends keyof MaintenanceSettings>(k: K, v: MaintenanceSettings[K]) => setM((x) => ({ ...x, [k]: v }));
  const nameOf = (id: string) => slackPeople.find((p) => p.id === id)?.name ?? "Someone without Slack linked";

  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        send("/api/operations/settings", "PATCH", { maintenance_intake_channel: intake, ops_channel: ops, area_channels: areas, maintenance: m }, "Saved.");
      }}
    >
      <label>
        <span className={label}>Maintenance requests are posted in (channel id)</span>
        <input className={field} value={intake} onChange={(e) => setIntake(e.target.value)} placeholder="C089YJB8XD1" />
      </label>
      <label>
        <span className={label}>Weekly summary and meeting recap go to (channel id)</span>
        <input className={field} value={ops} onChange={(e) => setOps(e.target.value)} placeholder="C0…" />
      </label>
      <div>
        <span className={label}>Each area&apos;s 07:00 message goes to (leave empty for none)</span>
        <div className="grid gap-2">
          {AREAS.map((a) => (
            <label key={a.key} className="grid grid-cols-[120px_1fr] items-center gap-3 md:grid-cols-[140px_1fr]">
              <span className="text-[13px] text-ink">{a.label}</span>
              <input
                className={field}
                value={areas[a.key] ?? ""}
                onChange={(e) => setAreas((x) => ({ ...x, [a.key]: e.target.value }))}
                placeholder="C0…"
              />
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-[color:var(--text-tertiary)]">
          Once the maintenance follow-up channel is set, it replaces Maintenance&apos;s 07:00 message.
        </p>
      </div>

      <div className="mt-4 border-t-2 border-ink pt-4">
        <div className="mono-label mb-3">Maintenance requests</div>
        <div className="grid gap-4">
          <label>
            <span className={label}>The request button is posted in (channel id)</span>
            <input className={field} value={m.button_channel} onChange={(e) => set("button_channel", e.target.value)} placeholder="The channel people ask in" />
          </label>
          <label>
            <span className={label}>07:00 follow-up goes to (channel id)</span>
            <input className={field} value={m.followup_channel} onChange={(e) => set("followup_channel", e.target.value)} placeholder="#maintenance-followup" />
          </label>
          <div>
            <span className={label}>Who can set Not started / In progress / Finished in Slack</span>
            <ul className="mb-2 divide-y divide-rule border border-rule">
              {m.status_user_ids.length === 0 && <li className="px-3 py-2.5 text-[13px] text-[color:var(--text-tertiary)]">Only the operations team.</li>}
              {m.status_user_ids.map((id) => (
                <li key={id} className="flex min-h-11 items-center justify-between gap-3 px-3">
                  <span className="text-[14px] text-ink">{nameOf(id)}</span>
                  <button
                    type="button"
                    className="min-h-11 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink hover:underline"
                    onClick={() => set("status_user_ids", m.status_user_ids.filter((x) => x !== id))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <select className={field} value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Add someone…</option>
                {slackPeople
                  .filter((p) => !m.status_user_ids.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={!adding}
                onClick={() => {
                  set("status_user_ids", [...m.status_user_ids, adding]);
                  setAdding("");
                }}
              >
                Add
              </Button>
            </div>
            <p className="mt-1.5 text-[12px] text-[color:var(--text-tertiary)]">
              Only people whose Slack is linked to their Hub profile are listed. The operations team can always change statuses.
            </p>
          </div>
          <label>
            <span className={label}>Guidelines and rules: shown on their own screen every time, before the form. A blank line starts a new paragraph; *bold* works.</span>
            <textarea className={cn(field, "min-h-64")} value={m.rules} onChange={(e) => set("rules", e.target.value)} maxLength={2500} />
          </label>
          <div>
            <span className={label}>Maintenance Crew hours (anything outside them is out of hours)</span>
            <div className="divide-y divide-rule border border-rule">
              {WEEK_ORDER.map((d) => {
                const h = m.hours[String(d)];
                const setDay = (v: { open: string; close: string } | null) => {
                  const next = { ...m.hours };
                  if (v) next[String(d)] = v;
                  else delete next[String(d)];
                  set("hours", next);
                };
                return (
                  <div key={d} className="grid min-h-11 grid-cols-[96px_1fr] items-center gap-2 px-3 py-1.5">
                    <label className="flex items-center gap-2 text-[13px] text-ink">
                      <input type="checkbox" className="size-4" checked={!!h} onChange={(e) => setDay(e.target.checked ? { open: "08:00", close: "16:00" } : null)} />
                      {DAYS[d].slice(0, 3)}
                    </label>
                    {h ? (
                      <div className="flex items-center gap-2">
                        <input className={cn(field, "min-w-0")} type="time" value={h.open} onChange={(e) => setDay({ ...h, open: e.target.value })} required aria-label={`${DAYS[d]} opens`} />
                        <span className="text-[13px] text-[color:var(--text-tertiary)]">to</span>
                        <input className={cn(field, "min-w-0")} type="time" value={h.close} onChange={(e) => setDay({ ...h, close: e.target.value })} required aria-label={`${DAYS[d]} closes`} />
                      </div>
                    ) : (
                      <span className="text-[13px] text-[color:var(--text-tertiary)]">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <label>
            <span className={label}>Out-of-hours message (on the form and in the confirmation). {"{when}"} becomes &ldquo;first thing tomorrow&rdquo;, &ldquo;first thing on Monday&rdquo; or &ldquo;later today at 08:00&rdquo;.</span>
            <textarea className={cn(field, "min-h-20")} value={m.hours_notice} onChange={(e) => set("hours_notice", e.target.value)} maxLength={500} required />
          </label>
        </div>
      </div>

      <div>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

// ── Post the request button / send the follow-up now ────────
export function MaintenanceSlackButtons() {
  const { busy, error, done, send } = useSend();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => send("/api/operations/slack", "POST", { action: "button" }, "Posted. Pin it in Slack: ⋯ on the message → Pin to channel.")}>
          Post the request button
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => send("/api/operations/slack", "POST", { action: "followup" }, "Follow-up sent.")}>
          Send the follow-up now
        </Button>
      </div>
      <Msg error={error} done={done} />
    </div>
  );
}
