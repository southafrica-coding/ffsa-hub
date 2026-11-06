"use client";

// Phone and tablet directory for the org chart. The canvas (org-canvas.tsx)
// is a pan/zoom drawing sized for a wide screen: fitting it into 375px shrinks
// names to a few pixels and turns every row into a miss. Below xl this list
// is the chart — same model, readable type, 44px targets, one team at a time.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  CLUSTER_LABEL,
  STATE_LABEL,
  initials,
  pctLabel,
  type OrgCluster,
  type OrgModel,
  type OrgState,
  type OrgTeam,
} from "@/lib/org-chart/model";
import {
  DIRECTORY_HOME,
  directoryOpenPerson,
  directoryOpenTeam,
  emptyRosterCopy,
  personLabel,
  personRoles,
  phoneAttention,
  type DirectoryScreen,
} from "@/lib/org-chart/phone";
import { applyDirectoryEdit, publishOrgEdit, subscribeOrgEdit } from "@/lib/org-chart/edit-share";
import { OrgEditPanel } from "./org-edit-panel";
import { ORG_CSS, ORG_VARS, T } from "./org-theme";

const MONO = "font-mono font-bold";
const COND = "font-[family-name:var(--font-roboto-condensed)] font-black";

const CLUSTER_ORDER: OrgCluster[] = [
  "leadership",
  "outward",
  "inward",
  "backbone",
  "alongside",
  "parttime",
  "unplaced",
];

function bossesOf(t: OrgTeam): string {
  return t.lines
    .filter((l) => l.kind !== "alongside")
    .map((l) => l.name)
    .join(" & ");
}

function Chip({ state }: { state: OrgState }) {
  const c = T.st[state];
  return (
    <span
      className={`${MONO} shrink-0 border px-1.5 py-[3px] text-[9px] tracking-[0.1em]`}
      style={{ color: c.color, background: c.bg, borderColor: c.border }}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

function Bar({ pct, state, measured = true }: { pct: number | null; state: OrgState; measured?: boolean }) {
  if (pct === null) return null;
  return (
    <div className="h-1 flex-1" style={{ background: T.track }} title={measured ? undefined : "Estimated from the status — no number recorded yet"}>
      <div style={{ width: `${pct}%`, height: 4, background: T.st[state].dot, opacity: measured ? 1 : 0.45 }} />
    </div>
  );
}

export function OrgPhone({ model, canManage }: { model: OrgModel; canManage: boolean }) {
  const teamById = useMemo(() => new Map(model.teams.map((t) => [t.id, t])), [model]);
  const [screen, setScreen] = useState<DirectoryScreen>(DIRECTORY_HOME);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const attention = phoneAttention(model);
  const place = screen.screen === "home" ? "home" : `${screen.screen}:${screen.id}`;
  const sawPlace = useRef(false);

  // The first history entry is the list. Each team or person pushes another,
  // so the browser Back button steps through the directory before leaving it.
  useEffect(() => {
    history.replaceState({ orgDir: DIRECTORY_HOME }, "");
    const onPop = (e: PopStateEvent) => {
      const next = (e.state as { orgDir?: DirectoryScreen } | null)?.orgDir ?? DIRECTORY_HOME;
      screenRef.current = next;
      setScreen(next);
    };
    window.addEventListener("popstate", onPop);
    const unsub = subscribeOrgEdit((share) => {
      const next = applyDirectoryEdit(screenRef.current, share);
      if (next === screenRef.current) return;
      screenRef.current = next;
      setScreen(next);
      history.replaceState({ orgDir: next }, "");
    });
    return () => {
      window.removeEventListener("popstate", onPop);
      unsub();
    };
  }, []);

  useEffect(() => {
    document.querySelector("[data-shell-main]")?.scrollTo({ top: 0 });
    if (!sawPlace.current) {
      sawPlace.current = true;
      return;
    }
    const target =
      (screen.focusId && document.getElementById(screen.focusId)) ||
      document.getElementById("org-dir-back") ||
      document.getElementById("org-dir-heading");
    target?.focus();
    // Focus only when the step changes, not on each search keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place]);

  const query = screen.q;
  const editMode = screen.edit;
  const teamId = screen.screen === "team" ? screen.id : null;
  const personId = screen.screen === "person" ? screen.id : null;

  const commit = (next: DirectoryScreen) => {
    screenRef.current = next;
    setScreen(next);
  };

  const setQuery = (q: string) => {
    const next = { ...screenRef.current, q, focusId: undefined };
    commit(next);
    history.replaceState({ orgDir: next }, "");
  };

  const setEditMode = (edit: boolean) => {
    const next = { ...screenRef.current, edit, focusId: undefined };
    commit(next);
    history.replaceState({ orgDir: next }, "");
  };

  const push = (next: DirectoryScreen) => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement.id : "";
    const prev = { ...screenRef.current, focusId: trigger || screenRef.current.focusId };
    history.replaceState({ orgDir: prev }, "");
    history.pushState({ orgDir: next }, "");
    commit(next);
  };

  const q = query.trim().toLowerCase();
  const searching = q.length >= 2;

  const teamHits = useMemo(() => {
    if (!searching) return [];
    return model.teams.filter((t) => t.name.toLowerCase().includes(q));
  }, [model.teams, q, searching]);

  const personHits = useMemo(() => {
    if (!searching) return [];
    const seen = new Map<string, { name: string; teams: string[] }>();
    for (const t of model.teams) {
      for (const m of t.members) {
        if (!m.name.toLowerCase().includes(q)) continue;
        const e = seen.get(m.userId) ?? { name: m.name, teams: [] };
        e.teams.push(t.name);
        seen.set(m.userId, e);
      }
    }
    return [...seen.entries()].map(([id, e]) => ({ id, name: e.name, teams: e.teams }));
  }, [model.teams, q, searching]);

  const openTeam = (id: string) => push(directoryOpenTeam(screenRef.current, id));
  const openPerson = (id: string) => push(directoryOpenPerson(screenRef.current, id));
  const goBack = () => history.back();

  const editing = editMode && teamId ? teamById.get(teamId) : undefined;

  // The desktop canvas is mounted beside this list. Publish the open edit
  // panel so crossing 1280px keeps the same team.
  useEffect(() => {
    publishOrgEdit({ edit: editMode, teamId: editing?.id ?? null });
  }, [editMode, editing?.id]);
  const open = !editMode && teamId ? teamById.get(teamId) : undefined;

  const kicker = editMode
    ? "ORG CHART · EDIT MODE"
    : `ORG CHART · FFSA ${model.cycleName ?? ""} · ${model.staffCount} STAFF · ${model.teams.length} TEAMS`;

  return (
    <div className="org-theme min-h-[50dvh]" style={{ ...ORG_VARS, background: T.frame, color: T.ink }}>
      <style>{ORG_CSS}</style>

      {editing ? (
        <div className="relative min-h-[calc(100dvh-7.5rem)]">
          <OrgEditPanel key={editing.id} t={editing} model={model} team={teamById} onClose={goBack} variant="page" />
        </div>
      ) : open ? (
        <TeamDetail
          t={open}
          model={model}
          teamById={teamById}
          canManage={canManage}
          onBack={goBack}
          onPerson={openPerson}
          onTeam={openTeam}
        />
      ) : personId ? (
        <PersonDetail
          userId={personId}
          model={model}
          teamById={teamById}
          onBack={goBack}
          onTeam={openTeam}
        />
      ) : (
        <>
          <header className="border-b border-[color:var(--org-border)] bg-[color:var(--org-surface)] px-5 pb-4 pt-5">
            <div className="mb-[7px] flex items-center gap-2.5">
              <span className="h-[3px] w-4 shrink-0" style={{ background: T.yellow }} />
              <span className={`${MONO} min-w-0 text-[10px] leading-snug tracking-[0.16em]`} style={{ color: T.mono }}>
                {kicker}
              </span>
            </div>
            <h1 id="org-dir-heading" tabIndex={-1} className={`${COND} m-0 text-[34px] uppercase leading-[0.9] outline-none`}>
              {editMode ? "Editing the chart" : "Rooted & Sent"}
            </h1>
            <p className="mt-2 text-[13px] leading-[1.45]" style={{ color: T.sub }}>
              {editMode
                ? "Tap a team to edit what it is for, its direction, shepherd and people. Moving a table stays on a larger screen."
                : "Teams, who leads them, and who they report to. Open a team for its people and OKRs."}
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              <label
                className="flex h-11 items-center gap-2.5 border bg-[color:var(--org-surface)] px-3 focus-within:border-[color:var(--org-yellow)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--org-yellow)]"
                style={{ borderColor: T.btnBorder }}
              >
                <Search size={16} color={T.mono} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a person or team"
                  aria-label="Find a person or team"
                  aria-describedby="org-dir-search-hint"
                  className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[color:var(--org-mono)]"
                />
              </label>
              <p id="org-dir-search-hint" className="text-[12px] leading-snug" style={{ color: T.sub }}>
                Type at least two letters. One letter is not enough to search.
              </p>
              {canManage && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditMode(!editMode)}
                    className={`${MONO} flex h-11 flex-1 items-center justify-center border px-3 text-[10px] uppercase tracking-[0.14em]`}
                    style={editMode ? { background: T.yellow, borderColor: T.yellow, color: T.onYellow } : { background: "transparent", borderColor: T.border, color: T.ink }}
                  >
                    {editMode ? "Done editing" : "Edit the chart"}
                  </button>
                  {!editMode && (
                    <Link
                      href="/org-chart/import"
                      className={`${MONO} flex h-11 flex-1 items-center justify-center border border-[color:var(--org-border)] bg-[color:var(--org-ink)] px-3 text-[10px] uppercase tracking-[0.14em] text-[color:var(--org-on-ink)]`}
                    >
                      Who is who
                    </Link>
                  )}
                </div>
              )}
            </div>
          </header>

          {attention && !searching && (
            <div className="flex items-center gap-3.5 px-5 py-3" style={{ background: T.yellow, color: T.onYellow }}>
              <div>
                <div className={`${MONO} text-[8.5px] tracking-[0.2em]`}>NEEDS YOU</div>
                <div className={`${COND} text-[30px] leading-none tabular-nums`}>{attention.n}</div>
              </div>
              <div className="w-0.5 self-stretch" style={{ background: T.onYellow }} />
              <div className="text-[13px] font-bold leading-[1.35]">{attention.text}</div>
            </div>
          )}

          {searching ? (
            <SearchResults
              teams={teamHits}
              people={personHits}
              onTeam={openTeam}
              onPerson={openPerson}
            />
          ) : (
            <ClusterList model={model} teamById={teamById} onTeam={openTeam} />
          )}
        </>
      )}
    </div>
  );
}

function SearchResults({
  teams,
  people,
  onTeam,
  onPerson,
}: {
  teams: OrgTeam[];
  people: { id: string; name: string; teams: string[] }[];
  onTeam: (id: string) => void;
  onPerson: (id: string) => void;
}) {
  if (teams.length === 0 && people.length === 0) {
    return (
      <p className="px-5 py-8 text-[14px]" style={{ color: T.sub }}>
        No person or team matches that.
      </p>
    );
  }
  return (
    <div>
      {teams.length > 0 && (
        <>
          <SectionHead title={`TEAMS · ${teams.length}`} />
          {teams.map((t) => (
            <TeamRow key={t.id} t={t} onClick={() => onTeam(t.id)} />
          ))}
        </>
      )}
      {people.length > 0 && (
        <>
          <SectionHead title={`PEOPLE · ${people.length}`} />
          {people.map((p) => (
            <button
              id={`org-person-${p.id}`}
              key={p.id}
              type="button"
              onClick={() => onPerson(p.id)}
              className="flex min-h-[52px] w-full items-center gap-3 border-b px-5 py-2.5 text-left"
              style={{ borderColor: T.row, background: T.surface }}
            >
              <span className={`${COND} flex h-10 w-10 shrink-0 items-center justify-center text-[15px]`} style={{ background: T.head, color: T.headInk }}>
                {initials(p.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold">{p.name}</span>
                <span className="mt-0.5 block truncate text-[12.5px]" style={{ color: T.sub }}>
                  {p.teams.join(" · ")}
                </span>
              </span>
              <span className={`${MONO} text-[12px]`} style={{ color: T.mono }}>›</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function ClusterList({
  model,
  teamById,
  onTeam,
}: {
  model: OrgModel;
  teamById: Map<string, OrgTeam>;
  onTeam: (id: string) => void;
}) {
  const sections = CLUSTER_ORDER.map((c) => ({
    cluster: c,
    teams: model.teams.filter((t) => t.cluster === c),
  })).filter((s) => s.teams.length > 0);

  return (
    <div className="pb-6">
      {sections.map((s) => (
        <section key={s.cluster}>
          <SectionHead title={CLUSTER_LABEL[s.cluster].toUpperCase()} right={`${s.teams.length}`} />
          {s.teams.map((t) => (
            <TeamRow key={t.id} t={t} parentName={t.parentId ? teamById.get(t.parentId)?.name : undefined} onClick={() => onTeam(t.id)} />
          ))}
        </section>
      ))}

      {model.schools.length > 0 && (
        <section>
          <SectionHead title="SCHOOLS IN SESSION" right={`${model.schools.length}`} />
          {model.schools.map((s) => (
            <div key={s.id} className="flex min-h-[48px] items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: T.row, background: T.surface }}>
              <span className="min-w-0 truncate text-[15px] font-bold">{s.name}</span>
              <span className={`${MONO} shrink-0 text-[10px] tracking-[0.08em]`} style={{ color: T.mono }}>
                {s.students} STUDENTS
              </span>
            </div>
          ))}
        </section>
      )}

      <section>
        <SectionHead title="FFSA DIRECTION" right={model.cycleName ?? ""} />
        {model.directions.map((d) => (
          <div key={d.key} className="border-b px-5 py-3" style={{ borderColor: T.row, background: T.surface }}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-bold">{d.title}</span>
              <span className={`${MONO} text-[10px] tracking-[0.08em]`} style={{ color: T.mono }}>
                {d.feeders.length} {d.feeders.length === 1 ? "OBJECTIVE" : "OBJECTIVES"}
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-[1.45]" style={{ color: T.sub }}>{d.def}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function TeamRow({ t, parentName, onClick }: { t: OrgTeam; parentName?: string; onClick: () => void }) {
  const stuck = t.objectives.some((o) => o.state === "stuck" || o.krs.some((k) => k.state === "stuck"));
  const bosses = bossesOf(t);
  const meta = [
    `${t.headcount} ${t.headcount === 1 ? "person" : "people"}`,
    t.leads.length ? t.leads.join(" & ") : "Lead not named",
    parentName ? `within ${parentName}` : "",
    bosses ? `reports to ${bosses}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      id={`org-team-${t.id}`}
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center gap-3 border-b px-5 py-3 text-left"
      style={{ borderColor: T.row, background: T.surface }}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[16px] font-bold">{t.name}</span>
          {stuck && (
            <span className={`${MONO} shrink-0 text-[9px] tracking-[0.12em]`} style={{ color: T.open }}>
              STUCK
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-[1.4]" style={{ color: T.sub }}>
          {meta}
        </span>
      </span>
      <span className={`${MONO} text-[14px]`} style={{ color: T.mono }} aria-hidden>
        ›
      </span>
    </button>
  );
}

function SectionHead({ title, right }: { title: string; right?: string }) {
  return (
    <div className="sticky top-14 z-[1] flex items-center justify-between gap-3 px-5 py-2 md:top-0" style={{ background: T.section }}>
      <span className={`${MONO} text-[10px] tracking-[0.16em]`} style={{ color: T.sectionInk }}>{title}</span>
      {right ? <span className={`${MONO} text-[10px] tracking-[0.1em]`} style={{ color: T.mono }}>{right}</span> : null}
    </div>
  );
}

function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="sticky top-14 z-[2] flex items-center border-b border-[color:var(--org-border)] bg-[color:var(--org-surface)] px-4 py-2 md:top-0">
      <button id="org-dir-back" type="button" onClick={onBack} className={`${MONO} flex h-11 items-center bg-[color:var(--org-ink)] px-4 text-[10px] tracking-[0.12em] text-[color:var(--org-on-ink)]`}>
        ← {label}
      </button>
    </div>
  );
}

function TeamDetail({
  t,
  model,
  teamById,
  canManage,
  onBack,
  onPerson,
  onTeam,
}: {
  t: OrgTeam;
  model: OrgModel;
  teamById: Map<string, OrgTeam>;
  canManage: boolean;
  onBack: () => void;
  onPerson: (id: string) => void;
  onTeam: (id: string) => void;
}) {
  const bosses = t.lines.filter((l) => l.kind !== "alongside");
  const alongside = t.lines.filter((l) => l.kind === "alongside");
  const parent = t.parentId ? teamById.get(t.parentId) : undefined;
  const children = model.teams.filter((c) => c.parentId === t.id);
  const facts: [string, string][] = [
    ["LEAD", t.leads.length ? t.leads.join(" & ") : "Not named yet"],
    ["REPORTS TO", bosses.map((l) => l.name).join(" & ") || "Not recorded yet"],
    ["OKR SHEPHERD", t.shepherd ?? "Not named yet"],
    ["PEOPLE", String(t.headcount)],
  ];

  return (
    <div>
      <BackBar label="ALL TEAMS" onBack={onBack} />
      <div className="px-5 pb-5 pt-5" style={{ background: T.surface }}>
        <div className="flex items-center gap-2.5">
          <span className="h-[3px] w-4" style={{ background: T.yellow }} />
          <span className={`${MONO} text-[10px] tracking-[0.16em]`} style={{ color: T.mono }}>
            {CLUSTER_LABEL[t.cluster].toUpperCase()}
          </span>
        </div>
        <h2 className={`${COND} mb-0 mt-2 text-[36px] uppercase leading-[0.9]`}>{t.name}</h2>
        <p className="mb-0 mt-3 text-[14px] leading-[1.5]" style={{ color: t.purpose ? T.sub : T.open }}>
          {t.purpose ?? "No purpose written down for this team yet."}
        </p>
      </div>
      <div className="grid grid-cols-2" style={{ background: T.surface, borderTop: `1px solid ${T.row}` }}>
        {facts.map(([label, value]) => (
          <div key={label} className="px-5 py-3" style={{ borderBottom: `1px solid ${T.row}` }}>
            <div className={`${MONO} text-[9px] tracking-[0.14em]`} style={{ color: T.mono }}>{label}</div>
            <div className="mt-1 text-[14px] font-bold leading-snug">{value}</div>
          </div>
        ))}
      </div>

      {(parent || children.length > 0 || alongside.length > 0) && (
        <>
          <SectionHead title="CONNECTED" />
          {parent && (
            <button type="button" onClick={() => onTeam(parent.id)} className="flex min-h-[48px] w-full items-center justify-between gap-3 border-b px-5 text-left" style={{ borderColor: T.row, background: T.surface }}>
              <span>
                <span className="block text-[15px] font-bold">{parent.name}</span>
                <span className={`${MONO} text-[9px] tracking-[0.1em]`} style={{ color: T.mono }}>WITHIN</span>
              </span>
              <span style={{ color: T.mono }}>›</span>
            </button>
          )}
          {children.map((c) => (
            <button key={c.id} type="button" onClick={() => onTeam(c.id)} className="flex min-h-[48px] w-full items-center justify-between gap-3 border-b px-5 text-left" style={{ borderColor: T.row, background: T.surface }}>
              <span>
                <span className="block text-[15px] font-bold">{c.name}</span>
                <span className={`${MONO} text-[9px] tracking-[0.1em]`} style={{ color: T.mono }}>TEAM WITHIN THIS ONE</span>
              </span>
              <span style={{ color: T.mono }}>›</span>
            </button>
          ))}
          {alongside.map((l) => (
            <div key={l.userId} className="border-b px-5 py-3" style={{ borderColor: T.row, background: T.surface }}>
              <div className="text-[15px] font-bold">{l.name}</div>
              <div className={`${MONO} text-[9px] tracking-[0.1em]`} style={{ color: T.mono }}>ALONGSIDE{l.label ? ` · ${l.label}` : ""}</div>
            </div>
          ))}
        </>
      )}

      <SectionHead title={`${model.cycleName ?? "THIS CYCLE"} OKRS`} />
      {t.objectives.length === 0 && (
        <p className="px-5 py-4 text-[14px] font-bold" style={{ color: T.open, background: T.surface }}>
          No objective this cycle yet.
        </p>
      )}
      {t.objectives.map((o) => {
        const dir = o.direction ? model.directions.find((d) => d.key === o.direction) : undefined;
        return (
          <div key={o.id} className="px-5 py-4" style={{ background: T.surface, borderBottom: `1px solid ${T.row}` }}>
            <div className={`${MONO} text-[9px] tracking-[0.12em]`} style={{ color: T.mono }}>
              {dir ? `ROLLS UP TO ${dir.title.toUpperCase()}` : "NO DIRECTION SET YET"}
            </div>
            <div className="mt-1.5 flex items-baseline gap-3">
              <span className="min-w-0 flex-1 text-[15px] font-bold leading-snug">{o.title}</span>
              {o.pct !== null ? <span className={`${COND} text-[22px] tabular-nums`}>{o.pct}%</span> : null}
            </div>
            {o.description ? <p className="mt-1.5 text-[13px] leading-[1.45]" style={{ color: T.sub }}>{o.description}</p> : null}
            <div className="mt-2 flex items-center gap-2">
              <Bar pct={o.pct} state={o.state} />
              <Chip state={o.state} />
            </div>
            <div className={`${MONO} mt-2 text-[9px] tracking-[0.1em]`} style={{ color: T.mono }}>
              {o.krs.length ? `${o.complete} OF ${o.krs.length} KEY RESULTS COMPLETE` : "NO KEY RESULTS YET"}
            </div>
            {o.krs.map((kr) => (
              <div key={kr.id} className="mt-2.5 border-t pt-2.5" style={{ borderColor: T.row }}>
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-[13.5px] leading-snug">{kr.text}</span>
                  <span className={`${COND} text-[16px] tabular-nums`} style={{ color: kr.measured ? T.ink : T.mono }}>
                    {pctLabel(kr.pct, kr.measured)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Bar pct={kr.pct} state={kr.state} measured={kr.measured} />
                  <Chip state={kr.state} />
                </div>
                <button
                  type="button"
                  disabled={!kr.ownerId}
                  onClick={kr.ownerId ? () => onPerson(kr.ownerId!) : undefined}
                  className={`${MONO} mt-1 text-left text-[9px] tracking-[0.1em] disabled:cursor-default`}
                  style={{ color: kr.ownerName ? T.mono : T.open }}
                >
                  {kr.ownerName ? `OWNER · ${kr.ownerName.toUpperCase()}` : "NO OWNER YET"}
                </button>
              </div>
            ))}
          </div>
        );
      })}

      <SectionHead title={`PEOPLE · ${t.members.length}`} />
      {t.members.length === 0 ? (
        <p className="px-5 py-4 text-[14px]" style={{ color: T.open, background: T.surface }}>
          {emptyRosterCopy(canManage)}
        </p>
      ) : (
        t.members.map((m) => (
            <button
            id={`org-person-${m.userId}`}
            key={m.userId}
            type="button"
            onClick={() => onPerson(m.userId)}
            className="flex min-h-[56px] w-full items-center gap-3 border-b px-5 py-2.5 text-left"
            style={{ borderColor: T.row, background: T.surface }}
          >
            <span className={`${COND} flex h-11 w-11 shrink-0 items-center justify-center text-[16px]`} style={{ background: T.head, color: T.headInk }}>
              {initials(m.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold">{m.name}</span>
              <span className="mt-0.5 block truncate text-[13px]" style={{ color: T.sub }}>
                {m.title ?? (m.isLead ? "Leader" : "Member")}
                {m.staffKind === "volunteer" ? " · Volunteer" : ""}
                {m.sharePct !== null ? ` · ${m.sharePct}%` : ""}
              </span>
            </span>
            <span style={{ color: T.mono }}>›</span>
          </button>
        ))
      )}
    </div>
  );
}

function PersonDetail({
  userId,
  model,
  teamById,
  onBack,
  onTeam,
}: {
  userId: string;
  model: OrgModel;
  teamById: Map<string, OrgTeam>;
  onBack: () => void;
  onTeam: (id: string) => void;
}) {
  const roles = personRoles(model, userId);
  const owned = model.teams.flatMap((t) =>
    t.objectives.flatMap((o) => o.krs.filter((k) => k.ownerId === userId).map((k) => ({ team: t, kr: k })))
  );
  const name = personLabel(model, userId);

  return (
    <div>
      <BackBar label="ALL TEAMS" onBack={onBack} />
      <div className="px-5 pb-5 pt-5" style={{ background: T.surface }}>
        <span className={`${COND} flex h-14 w-14 items-center justify-center text-[22px]`} style={{ background: T.yellow, color: T.onYellow }}>
          {initials(name)}
        </span>
        <h2 id="org-dir-heading" tabIndex={-1} className={`${COND} mb-0 mt-3 text-[34px] uppercase leading-[0.95] outline-none`}>{name}</h2>
        <p className="mt-1.5 text-[14px] font-bold" style={{ color: roles[0]?.title ? T.sub : T.open }}>
          {roles.length === 0
            ? "No role title written down yet."
            : roles.length === 1
              ? roles[0].title
              : roles.map((r) => `${r.title} · ${r.teamName}`).join("  ·  ")}
        </p>
      </div>

      <SectionHead title="SERVES ON" right={String(roles.length)} />
      {roles.length === 0 ? (
        <p className="px-5 py-4 text-[14px]" style={{ color: T.sub, background: T.surface }}>
          Not on a roster the chart can see.
        </p>
      ) : (
        roles.map((role) => (
          <button
            id={`org-team-${role.teamId}`}
            key={role.teamId}
            type="button"
            onClick={() => onTeam(role.teamId)}
            className="flex min-h-[52px] w-full items-center justify-between gap-3 border-b px-5 py-3 text-left"
            style={{ borderColor: T.row, background: T.surface }}
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold">{role.teamName}</span>
              <span className="mt-0.5 block text-[13px]" style={{ color: T.sub }}>
                {role.title}
              </span>
            </span>
            <span style={{ color: T.mono }}>›</span>
          </button>
        ))
      )}

      {roles.map((role) => (
        <div key={role.teamId}>
          <SectionHead title={`WHAT THIS ROLE CARRIES · ${role.teamName.toUpperCase()}`} />
          {role.responsibilities.length ? (
            role.responsibilities.map((r) => (
              <div key={r} className="border-b px-5 py-3 text-[14px] leading-[1.45]" style={{ borderColor: T.row, background: T.surface }}>
                {r}
              </div>
            ))
          ) : (
            <p className="border-b px-5 py-3 text-[14px] leading-[1.45]" style={{ borderColor: T.row, color: T.sub, background: T.surface }}>
              Nothing more than the title is written down for {role.teamName}.
            </p>
          )}
        </div>
      ))}

      <SectionHead title="KEY RESULTS OWNED" right={String(owned.length)} />
      {owned.length === 0 ? (
        <p className="px-5 py-4 text-[14px] leading-[1.45]" style={{ color: T.sub, background: T.surface }}>
          Doesn&apos;t own a key result this cycle.
        </p>
      ) : (
        owned.map(({ team: ownerTeam, kr }) => (
          <div key={kr.id} className="border-b px-5 py-3" style={{ borderColor: T.row, background: T.surface }}>
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-[14px] font-bold leading-snug">{kr.text}</span>
              <span className={`${COND} text-[16px] tabular-nums`}>{pctLabel(kr.pct, kr.measured)}</span>
            </div>
            <button type="button" onClick={() => onTeam(ownerTeam.id)} className={`${MONO} mt-1 text-left text-[9px] tracking-[0.1em]`} style={{ color: T.mono }}>
              {teamById.get(ownerTeam.id)?.name.toUpperCase()} ›
            </button>
          </div>
        ))
      )}
    </div>
  );
}
