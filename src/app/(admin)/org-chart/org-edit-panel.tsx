"use client";

// Frame 43b: the edit-mode inspector. Every fact says where it lives —
//   ✎  typed here, saves when you leave the field (org_edit_field, 252)
//   ↗  comes from another module; the chart links out and never edits it
//   ∑  worked out from other facts; can't be typed over
// Leads and reporting lines are change sets (step J3), so they are shown,
// not edited, here.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DIRECTIONS, type OrgModel, type OrgTeam } from "@/lib/org-chart/model";
import { T } from "./org-theme";

const INK = T.ink;
const SUB = T.sub;
const MONO_C = T.mono;
const RULE = T.row;
const OPEN = T.open;
const YELLOW = T.yellow;
const MONO = "font-mono font-bold";
const COND = "font-[family-name:var(--font-roboto-condensed)] font-black";

const CLUSTERS: [string, string][] = [
  ["", "Not placed (or part-time)"],
  ["leadership", "Leadership"],
  ["outward", "Outward · Mission"],
  ["inward", "Inward · Formation"],
  ["backbone", "Backbone · Support"],
  ["alongside", "Alongside"],
];

const FIELD_LABEL: Record<string, string> = {
  name: "name",
  cluster: "cluster",
  purpose: "what it is for",
  role_title: "role",
  responsibilities: "what the role carries",
  share_pct: "share of time",
  staff_kind: "staff or volunteer",
  direction: "direction",
  user_id: "OKR Shepherd",
  is_active: "active",
  ends_on: "end date",
  member_role: "leader or member",
  is_point_leader: "point leader",
  status: "status",
};

type Save = (body: Record<string, unknown>) => Promise<boolean>;

export function useOrgSave() {
  const router = useRouter();
  const [state, setState] = useState<{ saving: boolean; savedAt: string | null; error: string | null }>({
    saving: false,
    savedAt: null,
    error: null,
  });
  const save: Save = async (body) => {
    setState((s) => ({ ...s, saving: true, error: null }));
    try {
      const res = await fetch("/api/org-chart/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save");
      setState({ saving: false, savedAt: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), error: null });
      router.refresh();
      return true;
    } catch (e) {
      setState((s) => ({ ...s, saving: false, error: e instanceof Error ? e.message : "Couldn't save" }));
      return false;
    }
  };
  return { save, ...state };
}

function Tag({ kind, text }: { kind: "here" | "module" | "worked" | "changeset"; text?: string }) {
  const label =
    text ??
    { here: "✎ TYPED HERE · SAVES NOW", module: "↗ FROM ANOTHER MODULE", worked: "∑ WORKED OUT", changeset: "CHANGE SET · COMING IN J3" }[kind];
  return (
    <span className={`${MONO} text-[7.5px] tracking-[0.12em]`} style={{ color: kind === "here" ? INK : MONO_C }}>
      {label}
    </span>
  );
}

function Section({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-[22px] py-2" style={{ background: T.section }}>
      <span className={`${MONO} text-[9px] tracking-[0.18em]`} style={{ color: T.sectionInk }}>{title}</span>
      {right}
    </div>
  );
}

const INPUT =
  "w-full min-w-0 border px-2.5 py-2 text-[13px] outline-none";

/** A text field that saves when you leave it, and only if it changed. */
function SaveText({
  value,
  onSave,
  multiline,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onSave: (v: string) => Promise<boolean>;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async () => {
    if (draft.trim() === value.trim()) return;
    const ok = await onSave(draft);
    if (!ok) setDraft(value);
  };
  const common = {
    value: draft,
    placeholder,
    "aria-label": ariaLabel,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    className: INPUT,
    style: { borderColor: T.border },
  };
  return multiline ? (
    <textarea {...common} rows={3} className={`${INPUT} resize-y leading-[1.45]`} />
  ) : (
    <input {...common} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

function Labelled({ label, tag, children }: { label: string; tag: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 px-[22px] py-3" style={{ borderBottom: `1px solid ${RULE}` }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`${MONO} text-[8.5px] tracking-[0.14em]`} style={{ color: MONO_C }}>
          {label}
        </span>
        {tag}
      </div>
      {children}
    </div>
  );
}

// ── The panel ────────────────────────────────────────────────────────────

export function OrgEditPanel({
  t,
  model,
  team,
  onClose,
}: {
  t: OrgTeam;
  model: OrgModel;
  team: Map<string, OrgTeam>;
  onClose: () => void;
}) {
  const { save, saving, savedAt, error } = useOrgSave();
  const [open, setOpen] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const field = (table: string, id: string, f: string) => (value: unknown) => save({ op: "field", table, id, field: f, value });
  const shared = model.shared.filter((s) => s.a === t.id || s.b === t.id);
  const kicker = (CLUSTERS.find(([k]) => k === (t.clusterRaw ?? ""))?.[1] ?? "").toUpperCase();

  return (
    <div data-no-pan className="absolute bottom-0 right-0 top-0 z-20 flex w-full flex-col border-l border-[color:var(--org-border)] bg-[color:var(--org-drawer)] sm:w-[400px]" onPointerDown={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
      <div className="border-b border-[color:var(--org-border)] px-[22px] pb-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-[9px]">
            <span className="h-[3px] w-3.5 shrink-0" style={{ background: YELLOW }} />
            <span className={`${MONO} truncate text-[9px] tracking-[0.18em]`} style={{ color: MONO_C }}>
              {kicker || "NOT PLACED"} · TEAM
            </span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center border text-[16px] sm:h-8 sm:w-8" style={{ borderColor: T.border }}>
            ×
          </button>
        </div>
        <div className={`${COND} mt-2.5 text-[30px] uppercase leading-[0.95]`}>{t.name}</div>
        <div className={`${MONO} mt-2 text-[8.5px] tracking-[0.14em]`} style={{ color: error ? T.danger : MONO_C }}>
          {error ? `NOT SAVED · ${error.toUpperCase()}` : saving ? "SAVING…" : savedAt ? `ALL CHANGES SAVED · ${savedAt}` : "CHANGES SAVE AS YOU GO"}
        </div>
        <div className="mt-3 flex">
          {[
            ["EDIT", false],
            ["HISTORY", true],
          ].map(([label, h], i) => (
            <button
              key={String(label)}
              type="button"
              onClick={() => setShowHistory(h as boolean)}
              className={`${MONO} flex h-10 flex-1 items-center justify-center border text-[9px] tracking-[0.12em]`}
              style={{ marginLeft: i ? -1 : 0, background: showHistory === h ? T.ink : "transparent", color: showHistory === h ? T.onInk : SUB, borderColor: showHistory === h ? T.ink : T.border }}
            >
              {String(label)}
            </button>
          ))}
        </div>
      </div>

      {!t.shepherdId && t.objectives.length > 0 && !showHistory && (
        <div className="flex items-center gap-3.5 px-[22px] py-3" style={{ background: YELLOW, borderBottom: `2px solid ${T.onYellow}`, color: T.onYellow }}>
          <div className={`${MONO} shrink-0 text-[8.5px] tracking-[0.2em]`}>NEEDS YOU</div>
          <div className="w-0.5 self-stretch" style={{ background: T.onYellow }} />
          <div className="text-[13px] font-bold leading-[1.35]">{t.name} has no OKR Shepherd, so nobody sends its monthly update.</div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showHistory ? (
          <History ministryId={t.id} save={save} />
        ) : (
          <>
            <Section title="ABOUT THE TEAM" />
            <Labelled label="NAME" tag={<Tag kind="here" />}>
              <SaveText ariaLabel="Team name" value={t.name} onSave={field("staff_ministries", t.id, "name")} />
            </Labelled>
            <Labelled label="CLUSTER" tag={<Tag kind="here" />}>
              <select
                aria-label="Cluster"
                value={t.clusterRaw ?? ""}
                onChange={(e) => field("staff_ministries", t.id, "cluster")(e.target.value || null)}
                className={`${INPUT} h-10`}
                style={{ borderColor: T.border }}
              >
                {CLUSTERS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Labelled>
            <Labelled label="WHAT IT IS FOR" tag={<Tag kind="here" />}>
              <SaveText
                ariaLabel="What the team is for"
                multiline
                value={t.purposeRaw ?? ""}
                placeholder={t.purpose ? `Not written yet. The Ministry tab says: “${t.purpose}”` : "Not written yet"}
                onSave={field("staff_ministries", t.id, "purpose")}
              />
            </Labelled>
            <Labelled label="SUB-GROUPS" tag={<Tag kind="module" text="↗ MINISTRY TAB" />}>
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span>{t.groups.filter((g) => g.name !== "Team").map((g) => g.name).join(" · ") || "None"}</span>
                <Link href={`/ministry/${t.id}`} className={`${MONO} shrink-0 text-[9px] tracking-[0.1em] text-[color:var(--org-ink)] underline`}>
                  EDIT THERE ↗
                </Link>
              </div>
            </Labelled>

            <Section title="LEAD & REPORTING" right={<Tag kind="changeset" />} />
            <Labelled label="LEAD" tag={<Tag kind="module" text="↗ MINISTRY TAB FOR NOW" />}>
              <div className="flex items-center justify-between gap-3 text-[13px] font-bold">
                <span style={{ color: t.leads.length ? INK : OPEN }}>{t.leads.join(" & ") || "Not named yet"}</span>
                <Link href={`/ministry/${t.id}`} className={`${MONO} shrink-0 text-[9px] tracking-[0.1em] text-[color:var(--org-ink)] underline`}>
                  APPOINT ↗
                </Link>
              </div>
            </Labelled>
            <Labelled label="REPORTS TO" tag={<Tag kind="changeset" text="SET IN WHO IS WHO FOR NOW" />}>
              <span className="text-[13px] font-bold" style={{ color: t.lines.length ? INK : OPEN }}>
                {t.lines.filter((l) => l.kind !== "alongside").map((l) => l.name).join(" & ") || "Not recorded yet"}
              </span>
            </Labelled>

            <Section title={`${model.cycleName ?? ""} OKR`} right={<Tag kind="module" text="↗ WORDING ON THE OKRS PAGE" />} />
            {t.objectives.length === 0 ? (
              <div className="flex items-center justify-between gap-3 px-[22px] py-3 text-[13px]" style={{ borderBottom: `1px solid ${RULE}`, color: OPEN }}>
                <span className="font-bold">No objective this cycle yet</span>
                <Link href={`/okrs/${t.id}`} className={`${MONO} shrink-0 text-[9px] tracking-[0.1em] text-[color:var(--org-ink)] underline`}>
                  ADD ONE ↗
                </Link>
              </div>
            ) : (
              t.objectives.map((o) => (
                <div key={o.id} className="flex flex-col gap-2 px-[22px] py-3" style={{ borderBottom: `1px solid ${RULE}` }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-bold leading-[1.35]">{o.title}</span>
                    <Link href={`/okrs/${t.id}`} className={`${MONO} shrink-0 text-[9px] tracking-[0.1em] text-[color:var(--org-ink)] underline`}>
                      ↗
                    </Link>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className={`${MONO} shrink-0 text-[8.5px] tracking-[0.14em]`} style={{ color: MONO_C }}>
                      ROLLS UP TO
                    </span>
                    <select
                      aria-label={`Direction for ${o.title}`}
                      value={o.direction ?? ""}
                      onChange={(e) => field("okr_objectives", o.id, "direction")(e.target.value || null)}
                      className={`${INPUT} h-10`}
                      style={{ borderColor: o.direction ? T.border : OPEN }}
                    >
                      <option value="">No direction yet</option>
                      {DIRECTIONS.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-[11.5px]" style={{ color: SUB }}>
                    {o.krs.length} key result{o.krs.length === 1 ? "" : "s"} ·{" "}
                    {o.krs.filter((k) => k.ownerName).length} with an owner
                  </span>
                </div>
              ))
            )}
            <Labelled label="OKR SHEPHERD" tag={<Tag kind="here" />}>
              <select
                aria-label="OKR Shepherd"
                value={t.shepherdId ?? ""}
                onChange={(e) => save({ op: "shepherd", ministry_id: t.id, user_id: e.target.value || null })}
                className={`${INPUT} h-10`}
                style={{ borderColor: t.shepherdId ? T.border : OPEN }}
              >
                <option value="">Pick someone on {t.name}</option>
                {t.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Labelled>

            <Section title={`PEOPLE · ${t.members.length}`} right={<Tag kind="here" text="ROLE & SHARE · ✎ SAVES NOW" />} />
            {t.members.length === 0 && (
              <div className="px-[22px] py-3 text-[13px]" style={{ color: OPEN }}>
                Nobody on the roster yet. Add people on the Ministry tab or in Who is who.
              </div>
            )}
            {t.members.map((m) => {
              const isOpen = open === m.membershipId;
              const also = m.alsoOn.map((id) => team.get(id)?.name).filter(Boolean);
              return (
                <div key={m.membershipId} style={{ borderBottom: `1px solid ${RULE}` }}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : m.membershipId)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(isOpen ? null : m.membershipId))}
                    className="flex w-full cursor-pointer items-center gap-3 px-[22px] py-2.5 text-left"
                    style={{ background: isOpen ? T.openBg : "transparent" }}
                  >
                    <div className="min-w-0 flex-1 font-sans normal-case tracking-normal">
                      <div className="truncate text-[13.5px] font-bold">{m.name}</div>
                      <div className={`${MONO} mt-0.5 truncate text-[8px] tracking-[0.1em]`} style={{ color: MONO_C }}>
                        {[m.isLead ? "LEAD" : "", m.staffKind === "volunteer" ? "VOLUNTEER" : "", also.length ? `ALSO ON ${also.join(" · ").toUpperCase()}` : ""].filter(Boolean).join(" · ")}
                      </div>
                      <div className="truncate text-[12px]" style={{ color: m.roleTitle ? SUB : OPEN }}>
                        {m.roleTitle ?? "No role written yet"}
                      </div>
                    </div>
                    <span className={`${COND} shrink-0 text-[15px] tabular-nums tracking-normal`}>{m.sharePct === null ? "—" : `${m.sharePct}%`}</span>
                    <span className={`${MONO} shrink-0 text-[10px]`}>{isOpen ? "−" : "+"}</span>
                  </div>
                  {isOpen && (
                    <div className="flex flex-col gap-2.5 px-[22px] pb-3.5">
                      <SaveText ariaLabel={`Role for ${m.name}`} value={m.roleTitle ?? ""} placeholder="Role title" onSave={field("staff_ministry_members", m.membershipId, "role_title")} />
                      <SaveText
                        ariaLabel={`What ${m.name}'s role carries`}
                        multiline
                        value={m.responsibilities.join("\n")}
                        placeholder="What this role carries — one per line"
                        onSave={(v) => field("staff_ministry_members", m.membershipId, "responsibilities")(v.split("\n").map((x) => x.trim()).filter(Boolean))}
                      />
                      <div className="flex gap-2.5">
                        <div className="w-28">
                          <SaveText
                            ariaLabel={`Share of time for ${m.name}`}
                            value={m.sharePct === null ? "" : String(m.sharePct)}
                            placeholder="Share %"
                            onSave={async (v) => {
                              const n = v.trim() === "" ? null : Number(v.replace("%", ""));
                              if (n !== null && (!Number.isInteger(n) || n < 0 || n > 100)) return false;
                              return field("staff_ministry_members", m.membershipId, "share_pct")(n);
                            }}
                          />
                        </div>
                        <select
                          aria-label={`Staff or volunteer: ${m.name}`}
                          value={m.staffKind}
                          onChange={(e) => field("staff_ministry_members", m.membershipId, "staff_kind")(e.target.value)}
                          className={`${INPUT} h-10 flex-1`}
                          style={{ borderColor: T.border }}
                        >
                          <option value="staff">Staff</option>
                          <option value="volunteer">Volunteer · not in staff count</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <Section title="WORKED OUT · CHANGE THE FACTS ABOVE" />
            <Labelled label="HEADCOUNT" tag={<Tag kind="worked" />}>
              <span className="text-[13px]">
                <b>{t.headcount}</b> counted from the people on the team
              </span>
            </Labelled>
            {shared.map((s) => {
              const other = team.get(s.a === t.id ? s.b : s.a);
              return (
                <Labelled key={s.a + s.b} label={`LINE TO ${other?.name.toUpperCase() ?? ""}`} tag={<Tag kind="worked" />}>
                  <span className="text-[13px]">
                    Dotted · {s.people.join(", ")} {s.people.length === 1 ? "is" : "are"} on both teams
                  </span>
                </Labelled>
              );
            })}
            <Labelled label={`${model.updateMonthLabel} UPDATE`} tag={<Tag kind="worked" />}>
              <span className="text-[13px]">{t.objectives.length === 0 ? "Nothing to update" : t.updated ? "In · from the check-ins" : "Not in yet · from the check-ins"}</span>
            </Labelled>
            <p className="px-[22px] py-4 text-[11.5px] leading-[1.5]" style={{ color: SUB }}>
              Every edit is kept with who made it, when, and what it was before. Undo any of them from History.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────

type Row = {
  id: string;
  table_name: string;
  action: string;
  field: string | null;
  before: unknown;
  after: unknown;
  actor_id: string | null;
  created_at: string;
  undone_at: string | null;
  undo_of: string | null;
  subject_user_id: string | null;
};

function History({ ministryId, save }: { ministryId: string; save: Save }) {
  const [data, setData] = useState<{ rows: Row[]; names: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/org-chart/history?ministry=${ministryId}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!live) return;
        if (!ok) setError(d.error || "Couldn't load history");
        else setData(d);
      })
      .catch(() => live && setError("Couldn't load history"));
    return () => {
      live = false;
    };
  }, [ministryId, tick]);

  if (error) return <p className="px-[22px] py-4 text-[13px] text-destructive">{error}</p>;
  if (!data) return <p className="px-[22px] py-4 text-[13px]" style={{ color: SUB }}>Loading…</p>;
  if (!data.rows.length)
    return (
      <p className="px-[22px] py-4 text-[13px]" style={{ color: SUB }}>
        Nothing has been changed on this team yet.
      </p>
    );

  const show = (v: unknown, f: string | null) => {
    if (v === null || v === undefined || v === "") return "nothing";
    if (f === "user_id" && typeof v === "string") return data.names[v] ?? "someone";
    if (f === "direction" && typeof v === "string") return DIRECTIONS.find((d) => d.key === v)?.title ?? v;
    if (f === "share_pct") return `${v}%`;
    if (Array.isArray(v)) return v.length ? v.join("; ") : "nothing";
    return String(v);
  };

  const describe = (r: Row) => {
    const who = r.subject_user_id ? data.names[r.subject_user_id] : null;
    if (r.table_name === "okr_shepherds") {
      if (r.action === "created") return `Made ${data.names[(r.after as { user_id?: string })?.user_id ?? ""] ?? "someone"} the OKR Shepherd`;
      if (r.action === "deleted") return "Cleared the OKR Shepherd";
      return `Changed the OKR Shepherd from ${show(r.before, "user_id")} to ${show(r.after, "user_id")}`;
    }
    if (r.action === "created")
      return r.table_name === "staff_ministry_members" ? `Added ${who ?? "someone"} to the team` : r.table_name === "reporting_lines" ? "Added a reporting line" : "Created";
    if (r.action === "deleted")
      return r.table_name === "staff_ministry_members" ? `Removed ${who ?? "someone"} from the team` : r.table_name === "reporting_lines" ? "Ended a reporting line" : "Removed";
    const label = FIELD_LABEL[r.field ?? ""] ?? r.field;
    const whose = r.table_name === "staff_ministry_members" && who ? `${who}'s ` : r.table_name === "okr_objectives" ? "an objective's " : "";
    return `Changed ${whose}${label} from “${show(r.before, r.field)}” to “${show(r.after, r.field)}”`;
  };

  const undoable = (r: Row) =>
    !r.undone_at &&
    !r.undo_of &&
    (r.table_name === "okr_shepherds" || (r.action === "updated" && ["staff_ministries", "staff_ministry_members", "okr_objectives"].includes(r.table_name) && !!FIELD_LABEL[r.field ?? ""] && !["is_active", "ends_on", "member_role", "is_point_leader", "status"].includes(r.field ?? "")));

  return (
    <div>
      {data.rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-1 px-[22px] py-3" style={{ borderBottom: `1px solid ${RULE}`, opacity: r.undone_at ? 0.5 : 1 }}>
          <span className="text-[13px] leading-[1.4]" style={{ textDecoration: r.undone_at ? "line-through" : "none" }}>
            {r.undo_of ? "Undo: " : ""}
            {describe(r)}
          </span>
          <div className="flex items-center justify-between gap-3">
            <span className={`${MONO} text-[8px] tracking-[0.1em]`} style={{ color: MONO_C }}>
              {(r.actor_id ? data.names[r.actor_id] ?? "Someone" : "The Hub").toUpperCase()} ·{" "}
              {new Date(r.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).toUpperCase()}
              {r.undone_at ? " · UNDONE" : ""}
            </span>
            {undoable(r) && (
              <button
                type="button"
                onClick={async () => {
                  if (await save({ op: "undo", log_id: r.id })) setTick((x) => x + 1);
                }}
                className={`${MONO} flex h-9 items-center border border-[color:var(--org-border)] px-3 text-[8.5px] tracking-[0.12em]`}
              >
                UNDO
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
