"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Masthead, MastheadButton, SectionBar, StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { inType, itemsFor, plural, totalPoints, TYPES, type Checklist, type ChecklistItem } from "@/lib/fleet/rules";
import { ActionButton } from "../_components/ui";
import { fleetFetch } from "../_components/client-api";
import {
  SUGGEST_MONTHLY,
  addItem,
  addSection,
  allWeekly,
  blankItem,
  cleanChecklist,
  newId,
  normChecklist,
  removeItem,
  removeSection,
  routineOf,
  setItemText,
  setItemType,
  setRoutineById,
  setSectionName,
  sortCounts,
  applySuggestions,
  visibleItems,
} from "./checklist-edit";
import type { PointHelp } from "./help";

type Mode = "view" | "edit" | "sort";

const field = "min-h-11 w-full border border-rule-strong bg-white px-3 py-2 text-[15px] focus:border-ink focus:outline-none";
const smallBtn =
  "inline-flex min-h-11 items-center justify-center border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em]";

export function ChecklistScreen({
  checklist,
  standard,
  saved: savedProp,
  canManage,
  help,
}: {
  checklist: Checklist;
  standard: Checklist;
  saved: boolean;
  canManage: boolean;
  help: Record<string, PointHelp>;
}) {
  const router = useRouter();
  // What's shown: the live checklist, or what was just saved until the page refreshes.
  const [live, setLive] = useState({ cl: checklist, saved: savedProp, from: checklist });
  if (live.from !== checklist) setLive({ cl: checklist, saved: savedProp, from: checklist });

  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState<Checklist | null>(null);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cl = mode !== "view" && draft ? draft : live.cl;

  function start(m: "edit" | "sort") {
    setDraft(normChecklist(live.cl));
    setMode(m);
    document.querySelector("[data-shell-main]")?.scrollTo(0, 0);
  }
  function cancel() {
    setDraft(null);
    setMode("view");
  }
  async function save() {
    if (!draft) return;
    const r = cleanChecklist(draft);
    if ("error" in r) return toast.error(r.error);
    setSaving(true);
    try {
      await fleetFetch("/api/vehicles/fleet/settings", { method: "PATCH", body: { checklist: r.checklist } });
      setLive({ cl: r.checklist, saved: true, from: checklist });
      setDraft(null);
      setMode("view");
      toast.success("Checklist saved.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const toggleHelp = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const helpOpen = (id: string) => showAll || open.has(id);

  if (mode === "sort" && draft) {
    const c = sortCounts(draft);
    return (
      <>
        <Masthead context="Fleet · Checklist" title="Weekly or monthly" />
        <div className="pb-6">
          <p className="px-5 pt-4 text-[14px] text-[#55524A] md:px-8">Choose how often each point is checked</p>
          <p className="mx-5 mt-4 max-w-3xl border border-rule-strong bg-bone px-4 py-3 text-[14px] leading-relaxed md:mx-8">
            Weekly points are checked on every inspection day. Monthly points are added once a month: the first inspection of each month is the
            monthly check, which covers both. Points that change slowly are marked <strong>Suggested: monthly</strong>. Follow the suggestion or not;
            it’s your call. Tap <strong>Why and how</strong> to see what a point involves.
          </p>
          <div className="flex flex-wrap items-center gap-2 px-5 py-4 md:px-8">
            <span className="mr-auto text-[14px]" aria-live="polite">
              <strong>{c.w}</strong> points every week · <strong>{c.m}</strong> more once a month (monthly check: {c.w + c.m})
            </span>
            <ActionButton
              onClick={() => {
                setDraft(applySuggestions(draft));
                toast.success("Suggestions applied. Check them, then save.");
              }}
            >
              Use all suggestions
            </ActionButton>
            <ActionButton onClick={() => setDraft(allWeekly(draft))}>Make all weekly</ActionButton>
          </div>
          {draft.sections.map((sec) => {
            const items = sec.items.filter((it) => inType(it, "monthly"));
            if (!items.length) return null;
            return (
              <section key={sec.id} className="mb-4">
                <SectionBar title={sec.name} />
                <ul className="divide-y divide-rule">
                  {items.map((it) => {
                    const r = routineOf(it);
                    return (
                      <li key={it.id} data-item={it.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between md:px-8">
                        <div className="min-w-0 flex-1">
                          <PointText it={it} />
                          {SUGGEST_MONTHLY.has(it.id) && (
                            <span className="mt-1 inline-block border border-amber-border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-amber">
                              Suggested: monthly
                            </span>
                          )}
                          <HelpToggle id={it.id} help={help} open={helpOpen(it.id)} onToggle={toggleHelp} />
                        </div>
                        <div role="group" aria-label={`How often: ${it.t}`} className="flex shrink-0">
                          {(["weekly", "monthly"] as const).map((f) => (
                            <button
                              key={f}
                              type="button"
                              aria-pressed={r === f}
                              onClick={() => setDraft(setRoutineById(draft, it.id, f))}
                              className={cn(
                                smallBtn,
                                "flex-1 border-ink sm:flex-none",
                                f === "monthly" && "-ml-px",
                                r === f ? "bg-ink text-white" : "bg-white text-ink hover:bg-bone"
                              )}
                            >
                              {f === "weekly" ? "Every week" : "Once a month"}
                            </button>
                          ))}
                        </div>
                        {helpOpen(it.id) && help[it.id] && <HelpPanel h={help[it.id]} />}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        <SaveBar note="Changes apply to new inspections">
          <ActionButton onClick={cancel}>Cancel</ActionButton>
          <ActionButton tone="solid" onClick={save} disabled={saving}>
            Save
          </ActionButton>
        </SaveBar>
      </>
    );
  }

  if (mode === "edit" && draft) {
    return (
      <>
        <Masthead context="Fleet · Checklist" title="Inspection checklist" />
        <div className="pb-6">
          <p className="px-5 pt-4 text-[14px] text-[#55524A] md:px-8">
            {totalPoints(draft)} points in {draft.sections.length} sections
          </p>
          <p className="mx-5 mt-4 max-w-3xl border border-rule-strong bg-bone px-4 py-3 text-[14px] leading-relaxed md:mx-8">
            Tick which checks each point belongs to. Changes apply to new inspections; past inspections keep the wording they were saved with.
          </p>
          {draft.sections.map((sec, si) => (
            <section key={sec.id} className="mt-5 border-t border-ink">
              <div className="flex flex-wrap items-end gap-2 bg-bone px-5 py-3 md:px-8">
                <label className="grid min-w-0 flex-1 basis-56 gap-1.5">
                  <span className="mono-label">Section name</span>
                  <input className={field} value={sec.name} onChange={(e) => setDraft(setSectionName(draft, si, e.target.value))} />
                </label>
                <button
                  type="button"
                  className={cn(smallBtn, "border-destructive bg-white text-destructive hover:bg-bone")}
                  onClick={() => {
                    if (window.confirm("Remove this whole section from the checklist?")) setDraft(removeSection(draft, si));
                  }}
                >
                  Remove section
                </button>
              </div>
              <ul className="divide-y divide-rule">
                {sec.items.map((it, ii) => (
                  <li key={it.id} className="grid gap-2 px-5 py-3 md:grid-cols-[1fr_1fr_auto] md:items-start md:px-8">
                    <input
                      className={field}
                      value={it.t}
                      aria-label="Point"
                      placeholder="What to check"
                      autoFocus={it.id === focusId}
                      onChange={(e) => setDraft(setItemText(draft, si, ii, "t", e.target.value))}
                    />
                    <input
                      className={field}
                      value={it.h || ""}
                      aria-label="Hint"
                      placeholder="Hint (optional)"
                      onChange={(e) => setDraft(setItemText(draft, si, ii, "h", e.target.value))}
                    />
                    <div className="flex items-start gap-1 md:col-span-1">
                      <div className="flex flex-1 flex-wrap">
                        {TYPES.map((t) => (
                          <label key={t.id} className="flex min-h-11 cursor-pointer items-center gap-1.5 pr-3 text-[13px]">
                            <input
                              type="checkbox"
                              className="h-5 w-5 accent-[#0A0A0A]"
                              checked={(it.in || []).includes(t.id)}
                              onChange={(e) => setDraft(setItemType(draft, si, ii, t.id, e.target.checked))}
                            />
                            {t.short}
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="flex h-11 w-11 shrink-0 items-center justify-center border border-rule-strong text-[20px] leading-none hover:border-ink"
                        aria-label={`Remove ${it.t || "this point"}`}
                        onClick={() => setDraft(removeItem(draft, si, ii))}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="px-5 pb-1 pt-2 md:px-8">
                <ActionButton
                  onClick={() => {
                    const id = blankItem().id;
                    setFocusId(id);
                    setDraft(addItem(draft, si, id));
                  }}
                >
                  Add point
                </ActionButton>
              </div>
            </section>
          ))}
          <div className="mt-6 px-5 md:px-8">
            <ActionButton onClick={() => setDraft(addSection(draft, newId("s")))}>Add section</ActionButton>
          </div>
        </div>
        <SaveBar note="Editing the checklist">
          <ActionButton
            onClick={() => {
              if (window.confirm("Replace your edits with the standard checklist? Nothing changes until you save.")) setDraft(normChecklist(standard));
            }}
          >
            Restore standard list
          </ActionButton>
          <ActionButton onClick={cancel}>Cancel</ActionButton>
          <ActionButton tone="solid" onClick={save} disabled={saving}>
            Save checklist
          </ActionButton>
        </SaveBar>
      </>
    );
  }

  // ── View ──
  return (
    <>
      <Masthead
        context="Fleet · Checklist"
        title="Inspection checklist"
        actions={
          canManage ? (
            <>
              <MastheadButton onClick={() => start("sort")}>Sort weekly and monthly</MastheadButton>
              <MastheadButton tone="outline" onClick={() => start("edit")}>
                Edit checklist
              </MastheadButton>
            </>
          ) : undefined
        }
      />
      <p className="px-5 pt-4 text-[14px] text-[#55524A] md:px-8">
        {totalPoints(cl)} points in {cl.sections.length} sections{live.saved ? " · customised for FFSA" : " · standard list"}
      </p>

      <div className="mt-4 grid grid-cols-2 border-y border-ink sm:grid-cols-3 lg:grid-cols-5">
        {TYPES.map((t) => (
          <div key={t.id} className="border-b border-r border-rule px-5 py-4 md:px-6">
            <span className="numeral block text-[40px] leading-none">{itemsFor(cl, t.id).length}</span>
            <h3 className="mt-2 text-[15px] leading-tight">{t.label}</h3>
            <p className="mt-1 text-[13px] leading-snug text-[#55524A]">{t.help}</p>
          </div>
        ))}
      </div>

      <div role="toolbar" aria-label="Checklist view" className="flex flex-col gap-3 px-5 py-4 md:px-8">
        <div role="group" aria-label="Show points for" className="flex flex-wrap gap-1.5">
          {[["", "All points"] as const, ...TYPES.map((t) => [t.id, t.label] as const)].map(([k, l]) => (
            <button
              key={k || "all"}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={cn(
                "inline-flex min-h-11 items-center border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em]",
                filter === k ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-[#55524A] hover:border-ink hover:text-ink"
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[14px]">
          <input type="checkbox" className="h-5 w-5 accent-[#0A0A0A]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show why and how for every point
        </label>
        <p className="text-[13px] text-[#55524A]">
          Each point explains why it matters, how to check it, and what counts as OK, Monitor or Fix now. Tap <strong>Why and how</strong> on any
          point, here or while doing an inspection.
        </p>
      </div>

      <div className="pb-8">
        {cl.sections.map((sec) => {
          const items = visibleItems(sec, filter);
          if (!items.length) return null;
          return (
            <section key={sec.id} className="mb-4">
              <SectionBar title={sec.name} meta={plural(items.length, "point")} />
              <ul className="divide-y divide-rule">
                {items.map((it) => (
                  <li key={it.id} data-item={it.id} className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4 md:px-8">
                    <div className="min-w-0 flex-1">
                      <PointText it={it} />
                      <HelpToggle id={it.id} help={help} open={helpOpen(it.id)} onToggle={toggleHelp} />
                    </div>
                    <span className="flex shrink-0 flex-wrap gap-1 sm:max-w-[45%] sm:justify-end">
                      {measureUnit(it) && <StatusPill>{measureUnit(it)}</StatusPill>}
                      {TYPES.filter((t) => (it.in || []).includes(t.id)).map((t) => (
                        <StatusPill key={t.id} tone="quiet">
                          {t.short}
                        </StatusPill>
                      ))}
                      {!TYPES.some((t) => (it.in || []).includes(t.id)) && <StatusPill tone="warn">Not in any check</StatusPill>}
                    </span>
                    {helpOpen(it.id) && help[it.id] && <HelpPanel h={help[it.id]} />}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

const measureUnit = (it: ChecklistItem) => {
  const m = it.m as { u?: string } | null | undefined;
  return m && m.u ? m.u : "";
};

function PointText({ it }: { it: ChecklistItem }) {
  return (
    <>
      <span className="block text-[15px] leading-snug">{it.t}</span>
      {it.h && <span className="mt-0.5 block text-[13px] leading-snug text-[#55524A]">{it.h}</span>}
    </>
  );
}

function HelpToggle({ id, help, open, onToggle }: { id: string; help: Record<string, PointHelp>; open: boolean; onToggle: (id: string) => void }) {
  if (!help[id]) return null;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => onToggle(id)}
      className="-ml-1 mt-0.5 inline-flex min-h-11 items-center px-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink underline decoration-1 underline-offset-4"
    >
      {open ? "Hide why and how" : "Why and how"}
    </button>
  );
}

/** The app's helpHTML: why, safety, what it should look like, how to check, what goes
 *  wrong, how to mark it. */
export function HelpPanel({ h }: { h: PointHelp }) {
  const res = (
    [
      ["OK", h.markOk, "good"],
      ["Monitor", h.markMonitor, "warn"],
      ["Fix now", h.markFixNow, "bad"],
    ] as const
  ).filter((x) => x[1]);
  const head = "mono-label mb-1 block !text-ink";
  return (
    <div className="w-full basis-full space-y-3 border-l-2 border-ink bg-bone px-4 py-3 text-[14px] leading-relaxed">
      {h.why && (
        <div>
          <h4 className={head}>Why it matters</h4>
          <p>{h.why}</p>
        </div>
      )}
      {h.safetyFirst && (
        <p className="border-l-2 border-destructive pl-3">
          <strong>Safety first:</strong> {h.safetyFirst}
        </p>
      )}
      {h.looksLike && (
        <div>
          <h4 className={head}>What it should look like</h4>
          <p>{h.looksLike}</p>
        </div>
      )}
      {h.howToCheck && h.howToCheck.length > 0 && (
        <div>
          <h4 className={head}>How to check</h4>
          <ol className="list-decimal space-y-1 pl-5">
            {h.howToCheck.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </div>
      )}
      {h.whatGoesWrong && h.whatGoesWrong.length > 0 && (
        <div>
          <h4 className={head}>What can go wrong, and the signs</h4>
          <dl className="space-y-1.5">
            {h.whatGoesWrong.map((f, i) => (
              <div key={i}>
                <dt className="font-semibold">{f.problem}</dt>
                <dd>{f.signs}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {res.length > 0 && (
        <div>
          <h4 className={head}>How to mark it</h4>
          <dl className="space-y-1.5">
            {res.map(([l, t, tone]) => (
              <div key={l} className="grid grid-cols-[84px_1fr] items-start gap-2">
                <dt>
                  <StatusPill tone={tone}>{l}</StatusPill>
                </dt>
                <dd>{t}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

/** The sticky bar with Cancel / Save, above the phone's tab bar. */
function SaveBar({ note, children }: { note: string; children: React.ReactNode }) {
  return (
    <div className="sticky bottom-20 z-10 mb-20 border-t border-ink bg-white md:bottom-0 md:mb-0">
      <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 md:px-8">
        <span className="mr-auto basis-full text-[13px] text-[#55524A] sm:basis-auto">{note}</span>
        {children}
      </div>
    </div>
  );
}
