"use client";

// Frames 40a (the base as tables and lines) and 41a (zoom into one team).
// Light theme only. Every number on it is read from the model; the only
// thing the chart could ever store is where a table sits (org_layout).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GraduationCap, Heart, LayoutDashboard, Network, Search, UsersRound } from "lucide-react";
import {
  CLUSTER_LABEL,
  STATE_LABEL,
  initials,
  pctLabel,
  type OrgModel,
  type OrgObjective,
  type OrgState,
  type OrgTeam,
} from "@/lib/org-chart/model";
import { GEO, bezier, computeLayout, litSet, teamTableRows, type NodeId } from "@/lib/org-chart/layout";
import { OrgEditPanel, useOrgSave } from "./org-edit-panel";
import { ORG_CSS, ORG_VARS, T } from "./org-theme";

const MONO = "font-mono font-bold";
const COND = "font-[family-name:var(--font-roboto-condensed)] font-black";
const ZOOM_SCALE = 2.6;

type View = { s: number; tx: number; ty: number };

// ── Small pieces ─────────────────────────────────────────────────────────

function Chip({ state }: { state: OrgState }) {
  const c = T.st[state];
  return (
    <span
      className={`${MONO} shrink-0 border px-1.5 py-[3px] text-[7.5px] tracking-[0.1em]`}
      style={{ color: c.color, background: c.bg, borderColor: c.border }}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

/**
 * A status line with its bar. A measured bar is solid; one estimated from the
 * status (no metric on the key result) is drawn at reduced strength and
 * labelled "~" by the caller, so a guess never passes for a measurement.
 */
function Progress({ pct, state, thick = 4, measured = true }: { pct: number | null; state: OrgState; thick?: number; measured?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {pct !== null ? (
        <div className="flex-1" style={{ height: thick, background: T.track }} title={measured ? undefined : "Estimated from the status — no number recorded yet"}>
          <div style={{ width: `${pct}%`, height: thick, background: T.st[state].dot, opacity: measured ? 1 : 0.45 }} />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <Chip state={state} />
    </div>
  );
}

function SectionHead({ title, right }: { title: string; right?: string }) {
  return (
    <div className="flex justify-between gap-3 px-[22px] py-2" style={{ background: T.section }}>
      <span className={`${MONO} text-[9px] tracking-[0.18em] text-[color:var(--org-section-ink)]`}>{title}</span>
      {right ? <span className="font-mono text-[9px] tracking-[0.1em]" style={{ color: T.mono }}>{right}</span> : null}
    </div>
  );
}

type DRow = {
  title: string;
  meta?: string;
  right?: string;
  pct?: number | null;
  measured?: boolean;
  state?: OrgState;
  indent?: number;
  small?: boolean;
  onClick?: () => void;
};

function DrawerRow({ r }: { r: DRow }) {
  return (
    <div
      onClick={r.onClick}
      className="flex flex-col gap-[5px] py-[11px] pr-[22px]"
      style={{ paddingLeft: r.indent ?? 22, borderBottom: `1px solid ${T.row}`, cursor: r.onClick ? "pointer" : "default" }}
    >
      <div className="flex items-baseline gap-2.5">
        <span
          className="min-w-0 flex-1 leading-[1.3]"
          style={{ fontSize: r.small ? 12.5 : 13, fontWeight: r.small ? 500 : 700, color: T.ink }}
        >
          {r.title}
        </span>
        {r.right ? <span className={`${COND} shrink-0 text-[16px] leading-none tabular-nums`}>{r.right}</span> : null}
      </div>
      {r.state ? <Progress pct={r.pct ?? null} state={r.state} measured={r.measured ?? true} /> : null}
      {r.meta ? <span className="text-[11.5px] leading-[1.45]" style={{ color: T.sub }}>{r.meta}</span> : null}
    </div>
  );
}

// ── The canvas ───────────────────────────────────────────────────────────

export function OrgCanvas({
  model,
  savedLayout,
  canManage,
}: {
  model: OrgModel;
  savedLayout: Record<string, { x: number; y: number }>;
  canManage: boolean;
}) {
  // Tables moved in edit mode show where they were dropped straight away;
  // the server's org_layout catches up on the next refresh.
  const [moves, setMoves] = useState<Record<string, { x: number; y: number }>>({});
  const layout = useMemo(() => computeLayout(model, { ...savedLayout, ...moves }), [model, savedLayout, moves]);
  const [editMode, setEditMode] = useState(false);
  const { save: saveEdit, error: layoutError } = useOrgSave();
  const tableDrag = useRef<{ id: string; x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const team = useMemo(() => new Map(model.teams.map((t) => [t.id, t])), [model]);
  const dirByKey = useMemo(() => new Map(model.directions.map((d) => [d.key, d])), [model]);
  const leaderIds = useMemo(() => new Set(model.leaders.map((l) => l.userId)), [model]);

  const [sel, setSel] = useState<NodeId | null>(null);
  const [zoomTeam, setZoomTeam] = useState<string | null>(null);
  const [lastZoom, setLastZoom] = useState<string | null>(model.teams[0]?.id ?? null);
  const [person, setPerson] = useState<string | null>(null);
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const fitted = useRef(false);

  // Open at full size so a name stays readable and a row stays tappable.
  // Fitting the whole base into a laptop window used to shrink 11px type to
  // about 8px. Zoom out, or Fit, when you want every table in view at once.
  // The canvas is display:none below xl, so wait until it actually has a width
  // before locking that first view — a hidden mount reports 0.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 40) return;
      setSize({ w, h });
      if (!fitted.current) {
        fitted.current = true;
        setView({ s: 1, tx: 0, ty: 0 });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel: pinch / ctrl-wheel zooms at the cursor, a plain wheel pans.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (zoomTeam) return;
      // Panels sitting over the canvas scroll themselves; only the canvas pans.
      if ((e.target as Element | null)?.closest?.("[data-no-pan]")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          const s = clamp(v.s * Math.exp(-e.deltaY * 0.01), 0.3, 2);
          return { s, tx: px - ((px - v.tx) / v.s) * s, ty: py - ((py - v.ty) / v.s) * s };
        }
        return { ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTeam]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoomTeam || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) setDragging(true);
      d.moved = true;
      setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      // Leave `moved` readable by the click that follows this pointerup.
      setTimeout(() => (drag.current = null), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // A drag that ends over a table must not also select it.
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current?.moved || tableDrag.current?.moved) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // Clicking open space closes the panel, like its ×. A table, a name, the
  // panel itself and the controls are all left alone, and a drag-to-pan never
  // gets here (onClickCapture swallows the click that ends a drag).
  const onCanvasClick = (e: React.MouseEvent) => {
    if (zoomTeam || !sel) return;
    if ((e.target as Element).closest("[data-node], [data-no-pan]")) return;
    setSel(null);
  };

  const zoomBy = (f: number) =>
    setView((v) => {
      const s = clamp(v.s * f, 0.3, 2);
      const cx = size.w / 2;
      const cy = size.h / 2;
      return { s, tx: cx - ((cx - v.tx) / v.s) * s, ty: cy - ((cy - v.ty) / v.s) * s };
    });

  const fitWidth = () => {
    const s = clamp(size.w / layout.width, 0.3, 1);
    setView({ s, tx: 0, ty: 0 });
  };

  const centerOn = useCallback(
    (id: string) => {
      const p = layout.pos[id];
      if (!p) return;
      // Centre in the space the drawer leaves free (it is full-width on phones).
      const freeW = size.w >= 640 ? size.w - 360 : size.w;
      setView((v) => ({ ...v, tx: freeW / 2 - v.s * (p.x + p.w / 2), ty: size.h / 2 - v.s * (p.y + p.h / 2) }));
    },
    [layout, size]
  );

  const openTeam = (id: string | null) => {
    setZoomTeam(id);
    if (id) {
      setLastZoom(id);
      setSel("team:" + id);
      setPerson(null);
    }
  };

  // ── What is lit ──
  // OKR lines only while you are looking at OKRs: a selected team shows the
  // lines from its objectives to the FFSA direction they roll up to, a
  // selected direction shows every team that feeds it. Click away and both
  // the lines and the direction column go (Jack, 2026-10-19).
  const showOkrs = !!sel && (sel.startsWith("team:") || sel.startsWith("dir:"));
  const shown = layout.edges.filter((e) => e.kind !== "okr" || (showOkrs && (e.a === sel || e.b === sel)));
  const extra: NodeId[] = [];
  if (sel?.startsWith("lead:") && model.leadershipId) extra.push("team:" + model.leadershipId);
  if (sel === "team:" + model.leadershipId) model.leaders.forEach((l) => extra.push("lead:" + l.userId));
  if (sel?.startsWith("person:")) {
    const uid = sel.slice(7);
    model.teams.forEach((t) => t.members.some((m) => m.userId === uid) && extra.push("team:" + t.id));
    if (leaderIds.has(uid)) extra.push("lead:" + uid);
  }
  const lit = litSet(sel, shown, extra);
  const dim = (nid: NodeId) => !!sel && !lit.has(nid);

  // ── Search ──
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const teams = model.teams
      .filter((t) => t.name.toLowerCase().includes(q))
      .map((t) => ({ kind: "team" as const, id: t.id, label: t.name, meta: CLUSTER_LABEL[t.cluster] }));
    const seen = new Map<string, { name: string; teams: string[] }>();
    for (const t of model.teams)
      for (const m of t.members)
        if (m.name.toLowerCase().includes(q)) {
          const e = seen.get(m.userId) ?? { name: m.name, teams: [] };
          e.teams.push(t.name);
          seen.set(m.userId, e);
        }
    const people = [...seen.entries()].map(([id, e]) => ({ kind: "person" as const, id, label: e.name, meta: e.teams.join(" · ") }));
    return [...teams, ...people].slice(0, 8);
  }, [query, model]);

  const choose = (r: (typeof results)[number]) => {
    setQuery("");
    setSearchOpen(false);
    setZoomTeam(null);
    if (r.kind === "team") {
      setSel("team:" + r.id);
      centerOn(r.id);
    } else {
      setSel("person:" + r.id);
      const first = model.teams.find((t) => t.members.some((m) => m.userId === r.id));
      if (first) centerOn(first.id);
    }
  };

  // ── Drawer ──
  const pick = (nid: NodeId | null) => () => setSel(nid);
  const nodeName = (nid: NodeId) => {
    const [kind, key] = nid.split(":");
    if (kind === "team") return team.get(key)?.name ?? "A team";
    if (kind === "lead") return model.leaders.find((l) => l.userId === key)?.name ?? "A leader";
    if (kind === "dir") return dirByKey.get(key as never)?.title ?? "Direction";
    return "Schools in session";
  };
  const connectedRows = (nid: NodeId): DRow[] =>
    layout.edges
      .filter((e) => e.kind !== "okr" && (e.a === nid || e.b === nid))
      .map((e) => {
        const other = e.a === nid ? e.b : e.a;
        const meta =
          e.kind === "report"
            ? e.a === nid
              ? e.label === "integrates" ? "INTEGRATES" : "OVERSEES"
              : e.label === "integrates" ? "INTEGRATOR" : "REPORTS TO"
            : e.kind === "alongside"
              ? "ALONGSIDE"
              : e.label ?? "";
        return { title: nodeName(other), meta, right: "›", onClick: pick(other) };
      });

  const editing = editMode && sel?.startsWith("team:") ? team.get(sel.slice(5)) : undefined;
  const drawer = sel && !zoomTeam && !editing ? buildDrawer() : null;

  function objectiveRows(o: OrgObjective, teamName?: string): DRow[] {
    const dir = o.direction ? dirByKey.get(o.direction) : undefined;
    return [
      {
        title: o.title,
        right: o.pct !== null ? `${o.pct}%` : undefined,
        pct: o.pct,
        state: o.state,
        meta: [
          teamName,
          o.krs.length ? `${o.complete} of ${o.krs.length} key results complete` : "No key results yet",
          teamName ? "" : dir ? `Rolls up to ${dir.title}` : "No direction set yet",
        ]
          .filter(Boolean)
          .join(" · "),
        onClick: dir && !teamName ? pick("dir:" + dir.key) : undefined,
      },
      ...o.krs.map((kr) => ({
        title: kr.text,
        right: pctLabel(kr.pct, kr.measured),
        pct: kr.pct,
        measured: kr.measured,
        state: kr.state,
        small: true,
        indent: 40,
        meta: kr.ownerName ? `Key result · ${kr.ownerName}` : "Key result",
      })),
    ];
  }

  function buildDrawer() {
    const [kind, key] = sel!.split(":");
    const cycle = model.cycleName ?? "This cycle";
    type Band = { n: string; text: string } | null;

    if (kind === "team") {
      const t = team.get(key);
      if (!t) return null;
      const stuck = t.objectives.reduce((n, o) => n + o.krs.filter((k) => k.state === "stuck").length, 0);
      const bosses = t.lines.filter((l) => l.kind !== "alongside").map((l) => l.name);
      const band: Band = !t.objectives.length
        ? { n: "0", text: `objectives for ${cycle}. Every team holds one.` }
        : !t.updated
          ? { n: model.updateMonthLabel, text: "OKR update hasn't come in. Stuck is not a failure: silence is." }
          : stuck
            ? { n: String(stuck), text: `key result${stuck === 1 ? " is" : "s are"} stuck and need${stuck === 1 ? "s" : ""} help` }
            : null;
      return {
        kicker: CLUSTER_LABEL[t.cluster].toUpperCase(),
        title: t.name,
        sub: [
          `${t.headcount} ${t.headcount === 1 ? "person" : "people"}`,
          t.leads.length ? `${t.leads.join(" & ")} ${t.leads.length === 1 ? "leads" : "lead"}` : "lead not named yet",
          bosses.length ? `reports to ${bosses.join(" and ")}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        band,
        zoom: () => openTeam(t.id),
        sections: [
          {
            title: `${cycle} ${t.objectives.length > 1 ? "OBJECTIVES" : "OBJECTIVE"}`,
            right: t.objectives.some((o) => o.krs.some((k) => !k.measured)) ? "~ = FROM STATUS" : "OKRS",
            rows: t.objectives.length
              ? t.objectives.flatMap((o) => objectiveRows(o))
              : [{ title: "No objective this cycle yet", meta: "Draft one at the next all-team review, or ask Ally." }],
          },
          {
            title: "OKR RHYTHM",
            rows: [
              { title: t.shepherd ?? "Not named yet", meta: "OKR Shepherd · sends the monthly written update" },
              {
                title: !t.objectives.length
                  ? "Nothing to update"
                  : t.updated
                    ? `${titleCase(model.updateMonthLabel)} update is in`
                    : `No ${titleCase(model.updateMonthLabel)} update yet`,
                meta: "Monthly OKR update · status flags go to leadership",
              },
              { title: "Quarterly all-team review", right: nextReview(), meta: "Mar · Jun · Sep · Dec · cross-team sync and KR scoring" },
            ] as DRow[],
          },
          {
            title: `PEOPLE · ${t.headcount}`,
            right: `${t.groups.length} ${t.groups.length === 1 ? "GROUP" : "GROUPS"}`,
            rows: t.groups.map((g) => ({ title: g.name, right: String(g.people.length), meta: g.people.join(", ") })),
          },
          { title: "CONNECTED", right: String(connectedRows(sel!).length), rows: connectedRows(sel!) },
        ].filter((s) => s.rows.length),
      };
    }

    if (kind === "dir") {
      const d = dirByKey.get(key as never)!;
      const list = d.feeders.map((f) => ({ t: team.get(f.teamId)!, o: team.get(f.teamId)!.objectives.find((o) => o.id === f.objectiveId)! }));
      const stuck = list.filter((x) => x.o.state === "stuck").length;
      return {
        kicker: d.key === "care" ? "2026 · THE YEAR OF BUILDING WITH CARE" : `FFSA RHYTHM · ${d.code}`,
        title: d.title,
        sub: d.def,
        band: stuck ? { n: String(stuck), text: `of the ${list.length} objectives under it ${stuck === 1 ? "is" : "are"} stuck` } : null,
        sections: [
          {
            title: "WHAT ROLLS UP TO IT",
            right: d.pct !== null ? `${d.pct}%` : "",
            rows: list.length
              ? list.map(({ t, o }) => ({ ...objectiveRows(o, t.name)[0], onClick: pick("team:" + t.id) }))
              : [{ title: "No objective points here yet", meta: "An objective gets its direction when it is set at the December reset." }],
          },
        ],
      };
    }

    if (kind === "lead") {
      const l = model.leaders.find((x) => x.userId === key);
      const rows = connectedRows(sel!);
      return {
        kicker: l?.tag === "INTEGRATOR" ? "LEADERSHIP TEAM · INTEGRATOR" : "LEADERSHIP TEAM",
        title: l?.name ?? "Leader",
        sub: l?.title ?? "",
        band: null,
        sections: [{ title: "OVERSEES", right: String(rows.length), rows }].filter((s) => s.rows.length),
      };
    }

    if (kind === "person") {
      const teams = model.teams.filter((t) => t.members.some((m) => m.userId === key));
      const m = teams[0]?.members.find((x) => x.userId === key);
      const owned = model.teams.flatMap((t) => t.objectives.flatMap((o) => o.krs.filter((k) => k.ownerId === key)));
      return {
        kicker: "PERSON",
        title: m?.name ?? "Person",
        sub: m?.title ?? "",
        band: null,
        sections: [
          {
            title: "SERVES ON",
            right: String(teams.length),
            rows: teams.map((t) => ({
              title: t.name,
              meta: t.members.find((x) => x.userId === key)?.title ?? (t.members.find((x) => x.userId === key)?.isLead ? "Leader" : "Member"),
              right: "›",
              onClick: pick("team:" + t.id),
            })),
          },
          {
            title: "KEY RESULTS OWNED",
            right: String(owned.length),
            rows: owned.map((k) => ({ title: k.text, pct: k.pct, measured: k.measured, state: k.state, right: pctLabel(k.pct, k.measured), small: true })),
          },
        ].filter((s) => s.rows.length),
      };
    }

    const total = model.schools.reduce((n, s) => n + s.students, 0);
    return {
      kicker: "TRAINING · IN SESSION",
      title: "Schools in session",
      sub: `${total} students across ${model.schools.length} ${model.schools.length === 1 ? "school" : "schools"}.`,
      band: null,
      sections: [
        { title: "IN SESSION", right: String(model.schools.length), rows: model.schools.map((s) => ({ title: s.name, right: String(s.students), meta: `${s.students} active students` })) },
        { title: "CONNECTED", right: "", rows: connectedRows("schools") },
      ].filter((s) => s.rows.length),
    };
  }

  // ── Tables ──
  const { ROW, LW, DIR_H } = GEO;
  // Edit mode: drag a team's table to move it. Positions are in canvas units,
  // so the pointer's travel is divided by the current zoom.
  const startTableDrag = (id: string) => (e: React.PointerEvent) => {
    if (!editMode || e.button !== 0) return;
    e.stopPropagation(); // not a pan
    const p = layout.pos[id];
    tableDrag.current = { id, x: p.x, y: p.y, px: e.clientX, py: e.clientY, moved: false };
    const move = (ev: PointerEvent) => {
      const d = tableDrag.current;
      if (!d) return;
      const dx = (ev.clientX - d.px) / view.s;
      const dy = (ev.clientY - d.py) / view.s;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      setMoves((m) => ({ ...m, [d.id]: { x: Math.round(d.x + dx), y: Math.round(d.y + dy) } }));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = tableDrag.current;
      if (d?.moved) {
        saveEdit({
          op: "layout",
          ministry_id: d.id,
          x: Math.round(d.x + (ev.clientX - d.px) / view.s),
          y: Math.round(d.y + (ev.clientY - d.py) / view.s),
        });
      }
      setTimeout(() => (tableDrag.current = null), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const tableShell = (nid: NodeId | null, p: { x: number; y: number; w: number }, dashed = false) => {
    const on = !!nid && nid === sel;
    return {
      on,
      style: {
        left: p.x,
        top: p.y,
        width: p.w,
        background: T.surface,
        border: `1px ${dashed ? "dashed" : "solid"} ${T.border}`,
        outline: on ? `2px solid ${T.yellow}` : "0px solid transparent",
        outlineOffset: 2,
        opacity: nid && dim(nid) ? 0.3 : 1,
        transition: "opacity 0.2s",
      } as React.CSSProperties,
    };
  };

  function Head({ nid, on, icon, name, count }: { nid: NodeId | null; on: boolean; icon: React.ReactNode; name: string; count: string }) {
    return (
      <div
        onClick={nid ? pick(nid) : undefined}
        className="flex h-[34px] items-center gap-2 px-2.5"
        style={{ background: on ? T.yellow : T.head, cursor: nid ? "pointer" : "default", color: on ? T.onYellow : T.headInk }}
      >
        <span className="flex h-[13px] w-[13px] shrink-0 items-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{name}</span>
        <span className={`${MONO} shrink-0 text-[8.5px] tracking-[0.1em]`} style={{ color: on ? T.onYellow : T.headMono }}>
          {count}
        </span>
      </div>
    );
  }

  function Row({
    nid,
    mono,
    dot,
    text,
    right,
    ink,
    rightInk,
    height = ROW,
    bold,
    onClick,
  }: {
    nid?: NodeId;
    mono?: string;
    dot?: string;
    text: string;
    right?: string;
    ink?: string;
    rightInk?: string;
    height?: number;
    bold?: boolean;
    onClick?: () => void;
  }) {
    const on = !!nid && nid === sel;
    return (
      <div
        onClick={onClick ?? (nid ? pick(nid) : undefined)}
        className="flex items-center gap-[7px] px-2.5"
        style={{
          height,
          borderTop: `1px solid ${T.row}`,
          background: on ? T.yellow : "transparent",
          // A person row dims only while someone is being looked for; otherwise
          // it rises and falls with its team's card.
          opacity: nid && dim(nid) && (!nid.startsWith("person:") || sel?.startsWith("person:")) ? 0.3 : 1,
          cursor: onClick || nid ? "pointer" : "default",
        }}
      >
        {mono ? <span className={`${MONO} shrink-0 text-[8px] tracking-[0.08em]`} style={{ color: on ? T.onYellow : T.mono }}>{mono}</span> : null}
        {dot ? <span className="h-[7px] w-[7px] shrink-0" style={{ background: dot }} /> : null}
        <span className={`min-w-0 flex-1 truncate text-[11.5px] leading-[1.25] ${bold ? "font-bold" : "font-medium"}`} style={{ color: on ? T.onYellow : ink ?? T.ink }}>
          {text}
        </span>
        {right ? (
          <span className={`${MONO} shrink-0 text-[8.5px] tracking-[0.06em] tabular-nums`} style={{ color: on ? T.onYellow : rightInk ?? T.mono }}>
            {right}
          </span>
        ) : null}
      </div>
    );
  }

  const icon = (I: typeof Network) => <I size={13} strokeWidth={2.2} />;
  const leadership = model.leadershipId ? team.get(model.leadershipId) : undefined;
  const missio = model.missioId ? team.get(model.missioId) : undefined;

  const tables: React.ReactNode[] = [];
  // The FFSA direction: its place is reserved in the layout, but it is only
  // drawn while OKRs are being looked at.
  if (layout.pos.dir) {
    const p = layout.pos.dir;
    const s = tableShell(null, p);
    const selTeam = sel?.startsWith("team:") ? team.get(sel.slice(5)) : undefined;
    const undirected = selTeam ? selTeam.objectives.filter((o) => !o.direction).length : 0;
    tables.push(
      <div
        key="dir"
        data-node
        className="absolute"
        style={{
          ...s.style,
          opacity: showOkrs ? 1 : 0,
          pointerEvents: showOkrs ? "auto" : "none",
          transition: "opacity 0.25s",
        }}
        aria-hidden={!showOkrs}
      >
        <Head nid={null} on={false} icon={icon(LayoutDashboard)} name={`FFSA ${model.cycleName ?? ""} direction`} count="THE RHYTHM" />
        {model.directions.map((d) => (
          <Row
            key={d.key}
            nid={"dir:" + d.key}
            mono={d.code}
            dot={T.st[d.state].dot}
            text={d.title}
            right={d.pct !== null ? `${d.pct}%` : undefined}
            height={DIR_H}
          />
        ))}
        {selTeam && undirected > 0 && (
          <div className="px-2.5 py-2 text-[11px] leading-[1.4]" style={{ borderTop: `1px solid ${T.row}`, color: T.open }}>
            {undirected === selTeam.objectives.length
              ? `None of ${selTeam.name}'s objectives has a direction yet.`
              : `${undirected} of ${selTeam.name}'s objectives ${undirected === 1 ? "has" : "have"} no direction yet.`}{" "}
            Set them in edit mode and their lines appear here.
          </div>
        )}
      </div>
    );
  }
  if (leadership && layout.pos[leadership.id]) {
    const nid = "team:" + leadership.id;
    const s = tableShell(nid, { ...layout.pos[leadership.id], w: LW });
    tables.push(
      <div key={leadership.id} data-node className="absolute" style={{ ...s.style, cursor: editMode ? "move" : undefined }} onPointerDown={startTableDrag(leadership.id)}>
        <Head nid={nid} on={s.on} icon={icon(Network)} name={leadership.name} count={String(leadership.headcount)} />
        {model.leaders.length ? (
          model.leaders.map((l) => (
            <Row key={l.userId} nid={"lead:" + l.userId} text={l.name} right={l.tag} rightInk={l.tag === "INTEGRATOR" ? T.ink : T.mono} />
          ))
        ) : (
          <Row text="Nobody on the Leadership team roster yet" ink={T.open} />
        )}
      </div>
    );
  }
  if (missio && layout.pos[missio.id]) {
    const nid = "team:" + missio.id;
    const s = tableShell(nid, layout.pos[missio.id], true);
    tables.push(
      <div key={missio.id} data-node className="absolute" style={{ ...s.style, cursor: editMode ? "move" : undefined }} onPointerDown={startTableDrag(missio.id)}>
        <Head nid={nid} on={s.on} icon={icon(Heart)} name={missio.name} count="ALONGSIDE" />
        {missio.groups.length ? (
          missio.groups.map((g) => <Row key={g.name} text={g.name} right={String(g.people.length)} />)
        ) : (
          <Row text="Nobody on the roster yet" ink={T.mono} />
        )}
      </div>
    );
  }
  for (const t of model.teams) {
    if (t.id === model.leadershipId || t.id === model.missioId || !layout.pos[t.id]) continue;
    const nid = "team:" + t.id;
    const s = tableShell(nid, layout.pos[t.id]);
    const parent = t.parentId ? team.get(t.parentId) : undefined;
    const rows = teamTableRows(t);
    tables.push(
      <div key={t.id} data-node className="absolute" style={{ ...s.style, cursor: editMode ? "move" : undefined }} onPointerDown={startTableDrag(t.id)}>
        <Head nid={nid} on={s.on} icon={icon(UsersRound)} name={t.name} count={String(t.headcount)} />
        {parent ? <Row mono="WITHIN" text={parent.name} ink={T.mono} /> : null}
        {rows.leads.length ? (
          rows.leads.map((m) => (
            <Row key={m.userId} nid={"person:" + m.userId} mono="LEAD" text={m.name} bold />
          ))
        ) : (
          <Row mono="LEAD" text="Not named yet" ink={T.open} />
        )}
        {rows.shown.map((m) => (
          <Row key={m.userId} nid={"person:" + m.userId} text={m.name} />
        ))}
        <Row
          text={
            rows.more > 0
              ? `+ ${rows.more} more`
              : t.headcount === 0
                ? "Nobody on the roster yet"
                : `${t.headcount} ${t.headcount === 1 ? "person" : "people"}`
          }
          right="OPEN ›"
          ink={t.headcount === 0 ? T.open : T.mono}
          rightInk={T.ink}
          onClick={() => openTeam(t.id)}
        />
      </div>
    );
  }
  if (layout.pos.schools) {
    const s = tableShell("schools", layout.pos.schools);
    tables.push(
      <div key="schools" data-node className="absolute" style={s.style}>
        <Head nid="schools" on={s.on} icon={icon(GraduationCap)} name="Schools in session" count={String(model.schools.reduce((n, x) => n + x.students, 0))} />
        {model.schools.map((x) => (
          <Row key={x.id} text={x.name} right={String(x.students)} />
        ))}
      </div>
    );
  }

  const paths = shown
    .map((e) => ({ e, on: !!sel && (e.a === sel || e.b === sel) }))
    .sort((p, q) => Number(p.on) - Number(q.on))
    .map(({ e, on }, i) => (
      <path
        key={i}
        d={bezier(e.from, e.to)}
        fill="none"
        stroke={on ? (e.kind === "okr" ? T.st[e.state!].dot : T.edgeOn) : T.edge}
        strokeWidth={on ? (e.kind === "okr" ? 2.5 : 1.5) : 1}
        strokeDasharray={e.kind === "works" ? "4 4" : e.kind === "alongside" ? "2 4" : undefined}
        opacity={sel && !on ? 0.55 : 1}
      >
        {e.label && e.kind === "works" ? <title>{e.label}</title> : null}
      </path>
    ));

  // ── Zoom (41a) ──
  const zl = zoomTeam ?? lastZoom;
  const zt = zl ? team.get(zl) : undefined;
  const zp = zl ? layout.pos[zl] : undefined;
  const mapTransform =
    zoomTeam && zp
      ? `translate(${size.w / 2 - ZOOM_SCALE * (zp.x + zp.w / 2)}px, ${size.h / 2 - ZOOM_SCALE * (zp.y + zp.h / 2)}px) scale(${ZOOM_SCALE})`
      : `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
  const mapTransition = dragging
    ? "none"
    : zoomTeam
      ? "transform 0.8s cubic-bezier(.7,0,.25,1), opacity 0.35s ease 0.45s"
      : "transform 0.7s cubic-bezier(.2,.8,.2,1) 0.1s, opacity 0.3s ease 0.1s";

  const order = useMemo(
    () => [model.leadershipId, ...model.teams.filter((t) => t.id !== model.leadershipId && layoutHas(t.id)).map((t) => t.id)].filter(Boolean) as string[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, layout]
  );
  function layoutHas(id: string) {
    return !!layout.pos[id];
  }
  const oi = zl ? order.indexOf(zl) : -1;
  const prevId = order.length ? order[(oi + order.length - 1) % order.length] : null;
  const nextId = order.length ? order[(oi + 1) % order.length] : null;

  // Escape steps back: out of a team, then out of a selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoomTeam) setZoomTeam(null);
      else setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomTeam]);

  const kicker = editMode
    ? "ORG CHART · EDIT MODE · YOU ARE AN ORG ADMIN"
    : `ORG CHART · FFSA ${model.cycleName ?? ""} · ${model.staffCount} STAFF · ${model.teams.length} TEAMS`;

  return (
    <div className="org-theme flex h-[calc(100dvh-2rem)] min-h-[480px] flex-col" style={{ ...ORG_VARS, background: T.frame, color: T.ink }}>
      <style>{ORG_CSS}</style>
      {/* Top bar: 40a's masthead row */}
      <div className="flex flex-col gap-4 border-b border-[color:var(--org-border)] bg-[color:var(--org-surface)] px-5 pb-4 pt-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="min-w-0">
          <div className="mb-[7px] flex items-center gap-2.5">
            <span className="h-[3px] w-4 shrink-0" style={{ background: T.yellow }} />
            <span className={`${MONO} truncate text-[10px] tracking-[0.2em]`} style={{ color: T.mono }}>
              {kicker}
            </span>
          </div>
          <h1 className={`${COND} m-0 text-[34px] uppercase leading-[0.9] lg:text-[40px]`}>{editMode ? "Editing the chart" : <>Rooted &amp; Sent</>}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 lg:gap-3.5">
          <div className="relative w-full sm:w-[250px]">
            <div className="flex h-11 items-center gap-2.5 border bg-[color:var(--org-surface)] px-3 lg:h-10" style={{ borderColor: T.btnBorder }}>
              <Search size={14} color={T.mono} />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                onKeyDown={(e) => e.key === "Enter" && results[0] && choose(results[0])}
                placeholder="Find a person or team"
                aria-label="Find a person or team"
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--org-mono)]"
              />
            </div>
            {searchOpen && results.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-30 border border-t-0 border-[color:var(--org-border)] bg-[color:var(--org-surface)]">
                {results.map((r) => (
                  <button
                    key={r.kind + r.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(r)}
                    className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left hover:bg-[color:var(--org-hover)]"
                    style={{ borderColor: T.row }}
                  >
                    <span className="text-[13px] font-bold font-sans normal-case tracking-normal">{r.label}</span>
                    <span className={`${MONO} text-[8.5px] tracking-[0.1em]`} style={{ color: T.mono }}>
                      {r.kind === "team" ? "TEAM · " : ""}
                      {r.meta.toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setEditMode((v) => !v);
                setZoomTeam(null);
              }}
              className={`${MONO} flex h-11 items-center border px-3 text-[9px] uppercase tracking-[0.14em] lg:h-10`}
              style={editMode ? { background: T.yellow, borderColor: T.yellow, color: T.onYellow } : { background: "transparent", borderColor: T.border, color: T.ink }}
            >
              {editMode ? "Done editing" : "Edit the chart"}
            </button>
          )}
          {canManage && !editMode && (
            <Link
              href="/org-chart/import"
              className={`${MONO} flex h-11 items-center border border-[color:var(--org-border)] bg-[color:var(--org-ink)] px-3 text-[9px] uppercase tracking-[0.14em] text-[color:var(--org-on-ink)] hover:opacity-90 lg:h-10`}
            >
              Who is who
            </Link>
          )}
        </div>
      </div>

      {/* The canvas */}
      <div
        ref={viewport}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onClick={onCanvasClick}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
        style={{
          background: T.canvas,
          backgroundImage: T.dotsBg,
          backgroundSize: "20px 20px",
          cursor: zoomTeam ? "default" : dragging ? "grabbing" : "grab",
        }}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: layout.width,
            height: layout.height,
            transformOrigin: "0 0",
            transform: mapTransform,
            opacity: zoomTeam ? 0 : 1,
            transition: mapTransition,
          }}
        >
          {layout.zones.map((z) => (
            <div
              key={z.label}
              className="absolute flex items-baseline gap-3 px-3 py-[9px]"
              style={{ left: z.x, top: z.y, width: z.w, height: z.h, border: `1px dashed ${T.zone}` }}
            >
              <span className={`${MONO} text-[9px] tracking-[0.18em]`}>{z.label}</span>
              <span className="font-mono text-[8.5px] tracking-[0.12em]" style={{ color: T.mono }}>
                {z.meta}
              </span>
            </div>
          ))}
          <svg width={layout.width} height={layout.height} className="pointer-events-none absolute left-0 top-0 overflow-visible">
            {paths}
          </svg>
          {tables}
        </div>

        {/* Zoom + legend */}
        {!zoomTeam && (
          <div data-no-pan className="absolute bottom-4 left-4 flex flex-wrap items-stretch gap-2.5" onPointerDown={(e) => e.stopPropagation()}>
            <div className="flex border border-[color:var(--org-border)] bg-[color:var(--org-surface)]">
              <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)} className={`${MONO} flex h-11 w-11 items-center justify-center text-[14px] lg:h-9 lg:w-9`}>
                −
              </button>
              <span className={`${MONO} flex items-center px-2.5 text-[9px] tracking-[0.08em]`} style={{ borderLeft: `1px solid ${T.row}`, borderRight: `1px solid ${T.row}` }}>
                {Math.round(view.s * 100)}%
              </span>
              <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)} className={`${MONO} flex h-11 w-11 items-center justify-center text-[14px] lg:h-9 lg:w-9`}>
                +
              </button>
              <button
                type="button"
                onClick={fitWidth}
                className={`${MONO} flex h-11 items-center border-l px-3 text-[9px] tracking-[0.12em] lg:h-9`}
                style={{ borderColor: T.row }}
              >
                FIT
              </button>
            </div>
            <div className="hidden flex-wrap items-center gap-[18px] border border-[color:var(--org-border)] bg-[color:var(--org-surface)] px-3.5 py-2.5 md:flex">
              {showOkrs && <Legend line={`2.5px solid ${T.st.moving.dot}`} label="OKR" />}
              <Legend line={`1.5px solid ${T.edgeOn}`} label="REPORTS TO" />
              <Legend line={`1.5px dashed ${T.edgeOn}`} label="SHARED PERSON" />
            </div>
          </div>
        )}

        {/* Drawer */}
        {editing && (
          <OrgEditPanel key={editing.id} t={editing} model={model} team={team} onClose={() => setSel(null)} />
        )}

        {editMode && layoutError && (
          <div data-no-pan className="absolute left-4 top-4 z-10 max-w-[320px] border border-destructive bg-[color:var(--org-surface)] px-4 py-3 text-[12.5px] text-destructive" onPointerDown={(e) => e.stopPropagation()}>
            That position wasn&rsquo;t saved: {layoutError}
          </div>
        )}

        {editMode && !editing && (
          <div data-no-pan className="absolute right-4 top-4 z-10 max-w-[280px] border border-[color:var(--org-border)] bg-[color:var(--org-surface)] px-4 py-3 text-[12.5px] leading-[1.45]" onPointerDown={(e) => e.stopPropagation()}>
            <div className={`${MONO} mb-1 text-[8.5px] tracking-[0.14em]`} style={{ color: T.mono }}>
              EDIT MODE
            </div>
            Click a team to edit what it is for, its direction, shepherd and people. Drag a table to move it.
          </div>
        )}

        {drawer && (
          <div
            data-no-pan
            className="absolute bottom-0 right-0 top-0 z-20 flex w-full flex-col border-l border-[color:var(--org-border)] bg-[color:var(--org-drawer)] sm:w-[360px]"
            onPointerDown={(e) => e.stopPropagation()}
            style={{ cursor: "default" }}
          >
            <div className="border-b border-[color:var(--org-border)] px-[22px] pb-[18px] pt-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-[9px]">
                  <span className="h-[3px] w-3.5 shrink-0" style={{ background: T.yellow }} />
                  <span className={`${MONO} truncate text-[9px] tracking-[0.18em]`} style={{ color: T.mono }}>
                    {drawer.kicker}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={pick(null)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center border text-[16px] sm:h-8 sm:w-8"
                  style={{ borderColor: T.btnBorder }}
                >
                  ×
                </button>
              </div>
              <div className={`${COND} mt-2.5 text-[30px] uppercase leading-[0.95]`}>{drawer.title}</div>
              {drawer.sub ? <div className="mt-[7px] text-[13px] leading-[1.45]" style={{ color: T.sub }}>{drawer.sub}</div> : null}
              {"zoom" in drawer && drawer.zoom ? (
                <button
                  type="button"
                  onClick={drawer.zoom}
                  className={`${MONO} mt-3.5 flex h-11 w-full items-center justify-center bg-[color:var(--org-ink)] text-[9.5px] tracking-[0.12em] text-[color:var(--org-on-ink)]`}
                >
                  OPEN THE TEAM · ROLES &amp; OKRS ›
                </button>
              ) : null}
            </div>
            {drawer.band ? (
              <div className="flex items-center gap-3.5 px-[22px] py-3" style={{ background: T.yellow, borderBottom: `2px solid ${T.onYellow}`, color: T.onYellow }}>
                <div>
                  <div className={`${MONO} text-[8.5px] tracking-[0.2em]`}>NEEDS YOU</div>
                  <div className={`${COND} text-[30px] leading-none tabular-nums`}>{drawer.band.n}</div>
                </div>
                <div className="w-0.5 self-stretch" style={{ background: T.onYellow }} />
                <div className="text-[13px] font-bold leading-[1.35]">{drawer.band.text}</div>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {drawer.sections.map((s) => (
                <div key={s.title}>
                  <SectionHead title={s.title} right={s.right} />
                  {s.rows.map((r, i) => (
                    <DrawerRow key={i} r={r} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 41a — zoomed into one team */}
        <div
          className="absolute inset-0 z-10 flex flex-col"
          style={{
            background: T.canvas,
            opacity: zoomTeam ? 1 : 0,
            transform: zoomTeam ? "scale(1)" : "scale(0.94)",
            transition: zoomTeam
              ? "opacity 0.4s ease 0.45s, transform 0.6s cubic-bezier(.2,.8,.2,1) 0.4s"
              : "opacity 0.25s ease, transform 0.3s ease",
            pointerEvents: zoomTeam ? "auto" : "none",
            cursor: "default",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {zt && (
            <TeamView
              t={zt}
              model={model}
              team={team}
              person={person}
              setPerson={setPerson}
              onBack={() => openTeam(null)}
              onPrev={prevId ? () => openTeam(prevId) : undefined}
              onNext={nextId ? () => openTeam(nextId) : undefined}
              prevName={prevId ? team.get(prevId)?.name ?? "" : ""}
              nextName={nextId ? team.get(nextId)?.name ?? "" : ""}
              openTeam={openTeam}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Legend({ line, label }: { line: string; label: string }) {
  return (
    <span className={`${MONO} flex items-center gap-[7px] text-[8.5px] tracking-[0.1em]`} style={{ color: T.sub }}>
      <span className="h-0 w-[22px]" style={{ borderTop: line }} />
      {label}
    </span>
  );
}

// ── 41a ──────────────────────────────────────────────────────────────────

function TeamView({
  t,
  model,
  team,
  person,
  setPerson,
  onBack,
  onPrev,
  onNext,
  prevName,
  nextName,
  openTeam,
}: {
  t: OrgTeam;
  model: OrgModel;
  team: Map<string, OrgTeam>;
  person: string | null;
  setPerson: (id: string) => void;
  onBack: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  prevName: string;
  nextName: string;
  openTeam: (id: string) => void;
}) {
  const dirTitle = (k: string | null) => model.directions.find((d) => d.key === k)?.title;
  const krsOf = (uid: string) => t.objectives.flatMap((o) => o.krs.filter((k) => k.ownerId === uid));
  const cur = t.members.find((m) => m.userId === person) ?? t.members[0];
  const bosses = t.lines.filter((l) => l.kind !== "alongside").map((l) => l.name);
  const facts: [string, string][] = [
    ["LEAD", t.leads.length ? t.leads.join(" & ") : "Not named yet"],
    ["REPORTS TO", bosses.join(" & ") || "Not recorded yet"],
    ["OKR SHEPHERD", t.shepherd ?? "Not named yet"],
    ["PEOPLE", String(t.headcount)],
  ];
  const curKrs = cur ? krsOf(cur.userId) : [];

  return (
    <>
      <div className="flex h-auto shrink-0 flex-wrap items-center gap-3 border-b border-[color:var(--org-border)] bg-[color:var(--org-surface)] px-4 py-2.5 lg:h-[60px] lg:flex-nowrap lg:gap-[18px] lg:px-5 lg:py-0">
        <button type="button" onClick={onBack} className={`${MONO} flex h-11 items-center bg-[color:var(--org-ink)] px-4 text-[9.5px] tracking-[0.12em] text-[color:var(--org-on-ink)] lg:h-10`}>
          ← THE WHOLE BASE
        </button>
        <span className={`${MONO} hidden min-w-0 flex-1 truncate whitespace-pre text-[9.5px] tracking-[0.14em] md:block`} style={{ color: T.mono }}>
          {`THE BASE  ›  ${CLUSTER_LABEL[t.cluster].toUpperCase()}  ›  ${t.name.toUpperCase()}`}
        </span>
        <div className="ml-auto flex">
          <button type="button" onClick={onPrev} className={`${MONO} flex h-11 max-w-[42vw] items-center truncate border px-3.5 text-[9px] tracking-[0.1em] lg:h-10`} style={{ borderColor: T.btnBorder }}>
            ‹ {prevName.toUpperCase()}
          </button>
          <button type="button" onClick={onNext} className={`${MONO} -ml-px flex h-11 max-w-[42vw] items-center truncate border px-3.5 text-[9px] tracking-[0.1em] lg:h-10`} style={{ borderColor: T.btnBorder }}>
            {nextName.toUpperCase()} ›
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[420px_minmax(0,1fr)_400px] lg:overflow-hidden">
        {/* Left: the team and its OKRs */}
        <div className="bg-[color:var(--org-surface)] lg:overflow-y-auto lg:border-r lg:border-[color:var(--org-border)]">
          <div className="px-[26px] pb-[22px] pt-[26px]">
            <div className="flex items-center gap-2.5">
              <span className="h-[3px] w-4" style={{ background: T.yellow }} />
              <span className={`${MONO} text-[9.5px] tracking-[0.2em]`} style={{ color: T.mono }}>
                {CLUSTER_LABEL[t.cluster].toUpperCase()}
              </span>
            </div>
            <h2 className={`${COND} mb-0 mt-2.5 text-[40px] uppercase leading-[0.9] lg:text-[50px]`}>{t.name}</h2>
            <p className="mb-0 mt-3.5 text-[13.5px] leading-[1.55]" style={{ color: t.purpose ? T.sub : T.open }}>
              {t.purpose ?? "No purpose written down for this team yet."}
            </p>
          </div>
          <div className="grid grid-cols-2" style={{ borderTop: `1px solid ${T.row}` }}>
            {facts.map(([label, value]) => (
              <div key={label} className="px-[26px] py-3" style={{ borderBottom: `1px solid ${T.row}` }}>
                <div className={`${MONO} text-[8px] tracking-[0.14em]`} style={{ color: T.mono }}>{label}</div>
                <div className="mt-1 text-[14px] font-bold">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-[18px] flex justify-between px-[26px] py-[9px]" style={{ background: T.section }}>
            <span className={`${MONO} text-[9px] tracking-[0.18em] text-[color:var(--org-section-ink)]`}>{model.cycleName ?? ""} OKRS</span>
          </div>
          {t.objectives.length === 0 && (
            <div className="px-[26px] py-4 text-[13px] font-bold" style={{ color: T.open }}>
              No objective this cycle yet.
            </div>
          )}
          {t.objectives.map((o) => (
            <div key={o.id} className="px-[26px] pb-1.5 pt-4" style={{ borderBottom: `1px solid ${T.row}` }}>
              <div className={`${MONO} text-[8px] tracking-[0.14em]`} style={{ color: T.mono }}>
                {o.direction ? `ROLLS UP TO ${dirTitle(o.direction)!.toUpperCase()}` : "NO DIRECTION SET YET"}
              </div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <span className="flex-1 text-[14.5px] font-bold leading-[1.35]">{o.title}</span>
                {o.pct !== null ? <span className={`${COND} text-[24px] leading-none tabular-nums`}>{o.pct}%</span> : null}
              </div>
              {o.description ? (
                <p className="mb-0 mt-1.5 text-[12.5px] leading-[1.45]" style={{ color: T.sub }}>
                  {o.description}
                </p>
              ) : null}
              <div className="my-2.5">
                <Progress pct={o.pct} state={o.state} thick={5} />
              </div>
              <div className={`${MONO} -mt-1 mb-2 text-[8px] tracking-[0.12em]`} style={{ color: T.mono }}>
                {o.krs.length ? `${o.complete} OF ${o.krs.length} KEY RESULTS COMPLETE` : "NO KEY RESULTS YET"}
              </div>
              {o.krs.map((kr) => (
                <div
                  key={kr.id}
                  onClick={kr.ownerId && t.members.some((m) => m.userId === kr.ownerId) ? () => setPerson(kr.ownerId!) : undefined}
                  className="flex flex-col gap-[5px] py-2.5 pl-4"
                  style={{ borderTop: `1px solid ${T.row}`, cursor: kr.ownerId ? "pointer" : "default" }}
                >
                  <div className="flex items-baseline gap-2.5">
                    <span className="flex-1 text-[12.5px] leading-[1.35]">{kr.text}</span>
                    <span className={`${COND} text-[15px] leading-none tabular-nums`} style={{ color: kr.measured ? T.ink : T.mono }}>
                      {pctLabel(kr.pct, kr.measured)}
                    </span>
                  </div>
                  <Progress pct={kr.pct} state={kr.state} thick={3} measured={kr.measured} />
                  <span className={`${MONO} text-[8px] tracking-[0.12em]`} style={{ color: kr.ownerName ? T.mono : T.open }}>
                    {kr.ownerName ? `OWNER · ${kr.ownerName.toUpperCase()}` : "NO OWNER YET"}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Middle: the people */}
        <div className="bg-[color:var(--org-surface)] lg:overflow-y-auto">
          <div className="sticky top-0 z-[1] grid grid-cols-[44px_minmax(0,1fr)_70px] gap-3.5 px-[22px] py-[9px] md:grid-cols-[44px_minmax(0,1fr)_70px_150px]" style={{ background: T.section }}>
            <span className={`${MONO} col-span-2 text-[9px] tracking-[0.18em] text-[color:var(--org-section-ink)]`}>PEOPLE · {t.members.length} · ROLE</span>
            <span className="font-mono text-[9px] tracking-[0.1em]" style={{ color: T.mono }}>OWNS</span>
            <span className="hidden font-mono text-[9px] tracking-[0.1em] md:block" style={{ color: T.mono }}>ALSO ON</span>
          </div>
          {t.members.length === 0 && (
            <div className="px-[22px] py-4 text-[13px]" style={{ color: T.open }}>
              Nobody is on this roster yet. Add people on the Ministry tab, or from Who is who.
            </div>
          )}
          {t.members.map((m) => {
            const on = m === cur;
            const kc = krsOf(m.userId).length;
            return (
              <div
                key={m.userId}
                onClick={() => setPerson(m.userId)}
                className="grid min-h-[58px] cursor-pointer grid-cols-[44px_minmax(0,1fr)_70px] items-center gap-3.5 px-[22px] py-[9px] md:grid-cols-[44px_minmax(0,1fr)_70px_150px]"
                style={{ borderBottom: `1px solid ${T.row}`, background: on ? T.yellow : "transparent" }}
              >
                <span
                  className={`${COND} flex h-10 w-10 items-center justify-center text-[15px]`}
                  style={{ background: on ? T.onYellow : T.head, color: on ? T.yellow : T.headInk }}
                >
                  {initials(m.name)}
                </span>
                <div className="min-w-0" style={{ color: on ? T.onYellow : T.ink }}>
                  <div className="truncate text-[14px] font-bold">{m.name}</div>
                  <div className="mt-0.5 truncate text-[12.5px]" style={{ color: on ? T.onYellow : T.sub }}>
                    {m.title ?? (m.isLead ? "Leader" : "Member")}
                  </div>
                </div>
                <span className={`${MONO} text-[8.5px] tracking-[0.1em]`} style={{ color: on ? T.onYellow : T.ink }}>{kc ? `${kc} KR${kc > 1 ? "S" : ""}` : ""}</span>
                <span className={`${MONO} hidden text-[8.5px] leading-[1.4] tracking-[0.06em] md:block`} style={{ color: on ? T.onYellow : T.sub }}>
                  {m.alsoOn.map((id) => team.get(id)?.name).filter(Boolean).join(" · ")}
                </span>
              </div>
            );
          })}
        </div>

        {/* Right: the person */}
        <div className="bg-[color:var(--org-surface)] lg:overflow-y-auto lg:border-l lg:border-[color:var(--org-border)]">
          {cur ? (
            <>
              <div className="border-b border-[color:var(--org-border)] px-6 pb-[22px] pt-[26px]">
                <div className="flex items-center gap-3.5">
                  <span className={`${COND} flex h-[58px] w-[58px] shrink-0 items-center justify-center text-[22px]`} style={{ background: T.yellow, color: T.onYellow }}>
                    {initials(cur.name)}
                  </span>
                  <span className={`${MONO} text-[9px] tracking-[0.16em]`} style={{ color: T.mono }}>
                    {t.name.toUpperCase()}
                    {cur.alsoOn.length ? ` + ${cur.alsoOn.length} MORE` : ""}
                  </span>
                </div>
                <div className={`${COND} mt-4 text-[34px] uppercase leading-[0.95]`}>{cur.name}</div>
                <div className="mt-1.5 text-[14px] font-bold leading-[1.4]" style={{ color: T.sub }}>
                  {cur.title ?? (cur.isLead ? "Leader" : "Member")}
                </div>
              </div>
              <SectionHead title="WHAT THIS ROLE CARRIES" />
              {cur.responsibilities.length ? (
                cur.responsibilities.map((r) => (
                  <div key={r} className="flex items-baseline gap-3 px-6 py-[11px]" style={{ borderBottom: `1px solid ${T.row}` }}>
                    <span className="h-1.5 w-1.5 shrink-0 -translate-y-0.5 bg-[color:var(--org-ink)]" />
                    <span className="text-[13.5px] leading-[1.45]">{r}</span>
                  </div>
                ))
              ) : (
                <div className="px-6 py-3.5 text-[13px] leading-[1.5]" style={{ borderBottom: `1px solid ${T.row}`, color: T.open }}>
                  {cur.title ? "Only the title is written down so far." : "Nothing is written down for this role yet."} The rest of this role description hasn&rsquo;t been filled in.
                </div>
              )}
              <SectionHead title="KEY RESULTS OWNED" />
              {curKrs.length ? (
                curKrs.map((kr) => (
                  <div key={kr.id} className="flex flex-col gap-1.5 px-6 py-3" style={{ borderBottom: `1px solid ${T.row}` }}>
                    <div className="flex items-baseline gap-2.5">
                      <span className="flex-1 text-[13px] font-bold leading-[1.35]">{kr.text}</span>
                      <span className={`${COND} text-[16px] leading-none tabular-nums`} style={{ color: kr.measured ? T.ink : T.mono }}>
                        {pctLabel(kr.pct, kr.measured)}
                      </span>
                    </div>
                    <Progress pct={kr.pct} state={kr.state} measured={kr.measured} />
                  </div>
                ))
              ) : (
                <div className="px-6 py-3.5 text-[13px] leading-[1.5]" style={{ borderBottom: `1px solid ${T.row}`, color: T.sub }}>
                  Doesn&rsquo;t own a key result this cycle. Carries the team&rsquo;s objective with everyone else.
                </div>
              )}
              {cur.alsoOn.length > 0 && (
                <>
                  <SectionHead title="ALSO SERVES ON" />
                  {cur.alsoOn.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => openTeam(id)}
                      className="flex h-12 w-full items-center justify-between px-6 text-left"
                      style={{ borderBottom: `1px solid ${T.row}` }}
                    >
                      <span className="text-[13.5px] font-bold font-sans normal-case tracking-normal">{team.get(id)?.name}</span>
                      <span className={`${MONO} text-[9px] tracking-[0.1em]`}>OPEN ›</span>
                    </button>
                  ))}
                </>
              )}
            </>
          ) : (
            <div className="px-6 py-6 text-[13px]" style={{ color: T.sub }}>
              Pick someone to see their role.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function titleCase(mon: string) {
  return mon.charAt(0) + mon.slice(1).toLowerCase();
}

/** The next quarterly review month (Mar / Jun / Sep / Dec), from today. */
function nextReview(): string {
  const m = new Date().getMonth(); // 0-11
  const next = [2, 5, 8, 11].find((q) => q >= m) ?? 2;
  return ["MAR", "JUN", "SEP", "DEC"][[2, 5, 8, 11].indexOf(next)];
}

