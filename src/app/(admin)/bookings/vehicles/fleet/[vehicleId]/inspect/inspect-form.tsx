"use client";

// The inspection (the Fleet app's inspectFormView + guidedHTML): choose the check; date,
// odometer, fuel, inspected by; Step by step (default) or Full list; Finish; Save. The
// draft is written to this device on every change and to the server every few seconds,
// and it survives closing the page and having no signal. Active time is tracked as the
// app's tickDraft: every tap or keystroke, with a gap over 10 minutes counting as 10.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Masthead, StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import {
  checklistIndex,
  fmtDate,
  fmtKm,
  fmtMins,
  inType,
  itemsFor,
  plural,
  STATUS,
  TYPES,
  typeOf,
  type AttentionItem,
  type Checklist,
  type FleetVehicle,
} from "@/lib/fleet/rules";
import {
  autoStatus,
  FUEL,
  guidedStages,
  guidedSteps,
  newDraft,
  newerDraft,
  progress,
  ROUTINE,
  saveNote,
  SLOTNAME,
  SLOTS,
  stageOf,
  tickDraft,
  toKm,
  type Draft,
  type DraftResult,
  type InspType,
  type Measure,
} from "@/lib/fleet/inspection";
import { FLEET, Plate, fileUrl, vehicleHref } from "../../_components/ui";
import { fleetFetch, uploadFleetFile } from "../../_components/client-api";
import { deleteServerDraft, fetchServerDraft, putServerDraft, readLocalDraft, removeLocalDraft, writeLocalDraft } from "./draft-store";
import { Point, STATE_TONE, Thumbs, UploadButton, attLabel, type PointItem } from "./point";

export interface TripOption {
  id: string;
  label: string;
}

export interface InspectFormProps {
  vehicle: FleetVehicle;
  checklist: Checklist;
  today: string;
  defaultType: InspType;
  inspectorName: string;
  startFresh: boolean;
  attention: AttentionItem[];
  attnByItem: Record<string, AttentionItem[]>;
  /** "On <vehicle>" box at Get ready: fuel, starting, bonnet, battery, spare wheel… */
  ready: [string, string][];
  modelNotes: Record<string, string>;
  providers: string[];
  trips: TripOption[];
  defaultBookingId: string;
}

const GUIDED_KEY = "ffsa-fleet-guided";
const field = "min-h-11 w-full border border-rule-strong bg-white px-3 py-2 text-[16px] focus:border-ink focus:outline-none";
const SUMMARY_PH: Record<string, string> = {
  pre: "e.g. Front left tyre looks soft; pumped it up before leaving.",
  post: "e.g. New scratch on the left sliding door; driver says the aircon is weak.",
  weekly: "e.g. Front tyres close to the limit; book tyres and alignment at Motech.",
  workshop: "e.g. Motech says the front pads have about 3 mm left; replace at the next service.",
};
const ATT_TONE: Record<string, "warn" | "quiet" | "bad"> = { damage: "warn", repair: "quiet", issue: "warn", fix: "bad", mon: "warn" };
const btn = "inline-flex min-h-11 items-center justify-center border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] disabled:opacity-50";
const btnOutline = cn(btn, "border-ink bg-white text-ink hover:bg-bone");
const btnSolid = cn(btn, "border-ink bg-ink text-white hover:bg-[#262622]");

function Panel({ title, meta, children }: { title?: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-rule">
      {title && (
        <div className="section-bar">
          <span className="section-bar-title">{title}</span>
          {meta && <span className="section-bar-meta">{meta}</span>}
        </div>
      )}
      <div className="px-4 py-4 md:px-6">{children}</div>
    </section>
  );
}

function AttentionList({ list, ix }: { list: AttentionItem[]; ix: ReturnType<typeof checklistIndex> }) {
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {list.map((a, i) => (
        <li key={i} className="flex gap-3 py-2.5 text-[14px]">
          <span className="shrink-0">
            <StatusPill tone={ATT_TONE[a.k] || "quiet"}>{attLabel(a.k)}</StatusPill>
          </span>
          <span className="min-w-0">
            <span className="block break-words">{a.t}</span>
            <span className="block text-[12px] text-[#55524A]">
              {[
                a.d ? fmtDate(a.d) : "",
                a.items.length ? "Check at: " + a.items.map((id) => (ix[id] ? ix[id].t : "")).filter(Boolean).join(", ") : "",
                a.src === "record" ? "from the workshop history" : a.src === "flag" ? "from the last inspection" : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function InspectForm(props: InspectFormProps) {
  const { vehicle: v, checklist: cl, today } = props;
  const router = useRouter();
  const [d, setD] = useState<Draft | null>(null);
  const [guidedPref, setGuidedPref] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const dRef = useRef<Draft | null>(null);
  const timeRef = useRef({ activeMs: 0, tick: 0 });
  const doneRef = useRef(false);
  const serverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverPut = useRef<Promise<void> | null>(null);
  const gcardRef = useRef<HTMLElement | null>(null);
  const ix = useMemo(() => checklistIndex(cl), [cl]);

  /** The draft with the time so far, as stored. */
  const snapshot = useCallback((): Draft | null => {
    const cur = dRef.current;
    return cur ? { ...cur, activeMs: timeRef.current.activeMs, tick: timeRef.current.tick } : null;
  }, []);

  // ── Open: the newer of this device's copy and the server's, or a new draft ──
  useEffect(() => {
    let alive = true;
    (async () => {
      let chosen: Draft | null = null;
      if (props.startFresh) {
        removeLocalDraft(v.id);
        await deleteServerDraft(v.id);
      } else {
        chosen = newerDraft(readLocalDraft(v.id), await fetchServerDraft(v.id));
      }
      if (!alive) return;
      if (!chosen) {
        chosen = newDraft(v, props.defaultType, today, props.inspectorName);
        chosen.bookingId = props.defaultBookingId;
      }
      try {
        setGuidedPref(localStorage.getItem(GUIDED_KEY) !== "list");
      } catch {
        // default: step by step
      }
      // Time while the page was closed doesn't count.
      timeRef.current = { activeMs: chosen.activeMs || 0, tick: Date.now() };
      dRef.current = chosen;
      setD(chosen);
      if (props.startFresh) {
        const u = new URL(window.location.href);
        u.searchParams.delete("new");
        window.history.replaceState(null, "", u.toString());
      }
    })();
    return () => {
      alive = false;
    };
    // Opened once; later server refreshes of the props must not replace the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keep it: on this device at once, on the server every few seconds ──
  useEffect(() => {
    if (!d || doneRef.current) return;
    const snap = snapshot();
    if (snap) writeLocalDraft(snap);
    if (!serverTimer.current)
      serverTimer.current = setTimeout(() => {
        serverTimer.current = null;
        const s = snapshot();
        if (s && !doneRef.current) serverPut.current = putServerDraft(s);
      }, 3000);
  }, [d, snapshot]);

  useEffect(() => {
    const flush = () => {
      const s = snapshot();
      if (!s || doneRef.current) return;
      writeLocalDraft(s);
      putServerDraft(s, true);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      if (serverTimer.current) clearTimeout(serverTimer.current);
      serverTimer.current = null;
      flush();
    };
  }, [snapshot]);

  const tick = useCallback(() => {
    if (dRef.current) tickDraft(timeRef.current);
  }, []);

  const update = useCallback((fn: (x: Draft) => void) => {
    const cur = dRef.current;
    if (!cur) return;
    const n = structuredClone(cur);
    fn(n);
    n.savedAt = Date.now();
    dRef.current = n;
    setD(n);
  }, []);

  const type = d?.type || props.defaultType;
  const guided = guidedPref && type !== "workshop";
  const steps = useMemo(() => guidedSteps(cl, type, v, props.attention.length > 0), [cl, type, v, props.attention.length]);
  const stages = useMemo(() => guidedStages(steps), [steps]);

  const gotoStep = useCallback(
    (n: number) => {
      update((x) => {
        x.gstep = Math.min(Math.max(n, 0), steps.length - 1);
      });
      requestAnimationFrame(() => gcardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    },
    [update, steps.length]
  );

  if (!d) {
    return (
      <>
        <Masthead context={`Fleet · ${v.name}`} title="Inspection" />
        <p className="px-5 py-6 text-[14px] text-[#55524A] md:px-8">Opening the draft…</p>
      </>
    );
  }

  const t = typeOf(type);
  const ids = itemsFor(cl, type);
  const prog = progress(cl, d);
  const soFar = Math.round(timeRef.current.activeMs / 60000);
  const step = Math.min(Math.max(d.gstep || 0, 0), steps.length - 1);

  // ── Actions ──

  function setStatus(id: string, s: string, inGuide: boolean) {
    const cur = dRef.current!;
    const prev = cur.results[id] && cur.results[id].s;
    const next = (prev === s ? null : s) as DraftResult["s"];
    update((x) => {
      const r = x.results[id] || (x.results[id] = { p: [] });
      r.s = next;
      if (next === "fix" || next === "mon") x.open["i:" + id] = true;
    });
    if (inGuide && (next === "ok" || next === "na")) {
      const at = step;
      setTimeout(() => {
        if (dRef.current && Math.min(dRef.current.gstep || 0, steps.length - 1) === at) gotoStep(at + 1);
      }, 280);
    }
    if (next === "fix" || next === "mon")
      setTimeout(() => (document.querySelector(`textarea[data-note="${CSS.escape(id)}"]`) as HTMLTextAreaElement | null)?.focus(), 60);
  }

  function setMeasure(id: string, val: string) {
    const m = ix[id] && (ix[id].m as Measure | undefined);
    update((x) => {
      const r = x.results[id] || (x.results[id] = { p: [] });
      r.v = val;
      const auto = autoStatus(m, val);
      if (auto) {
        r.s = auto;
        if (auto !== "ok") x.open["i:" + id] = true;
      }
    });
  }

  async function upload(target: string, files: File[]) {
    const i = target.indexOf(":");
    const kind = i < 0 ? target : target.slice(0, i);
    const key = i < 0 ? "" : target.slice(i + 1);
    setUploading((u) => ({ ...u, [target]: (u[target] || 0) + 1 }));
    for (const f of kind === "walk" ? files.slice(0, 1) : files) {
      try {
        const r = await uploadFleetFile(f, { type: "draft", id: v.id });
        update((x) => {
          if (kind === "item") {
            const res = x.results[key] || (x.results[key] = { p: [] });
            res.p = (res.p || []).concat(r.id);
          } else if (kind === "extra") x.extra = (x.extra || []).concat(r.id);
          else if (kind === "docs") x.docs = (x.docs || []).concat({ id: r.id, name: f.name, type: f.type });
          else if (kind === "walk") x.walk[key] = r.id;
        });
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setUploading((u) => ({ ...u, [target]: Math.max(0, (u[target] || 1) - 1) }));
  }

  function removePhoto(target: string, pid: string) {
    const i = target.indexOf(":");
    const kind = i < 0 ? target : target.slice(0, i);
    const key = i < 0 ? "" : target.slice(i + 1);
    update((x) => {
      if (kind === "item" && x.results[key]) x.results[key].p = (x.results[key].p || []).filter((p) => p !== pid);
      else if (kind === "extra") x.extra = (x.extra || []).filter((p) => p !== pid);
      else if (kind === "walk") delete x.walk[key];
    });
  }

  function setMode(m: "guided" | "list") {
    setGuidedPref(m === "guided");
    try {
      localStorage.setItem(GUIDED_KEY, m);
    } catch {
      // per device only
    }
    window.scrollTo(0, 0);
  }

  async function save() {
    tick();
    const cur = snapshot()!;
    if (!cur.date) {
      toast.error("Enter the date of the inspection.");
      document.getElementById("f-date")?.focus();
      return;
    }
    const odo = toKm(cur.odometer);
    if (odo === null || odo <= 0) {
      toast.error("Enter the odometer reading in km.");
      document.getElementById("f-odo")?.focus();
      return;
    }
    if (!ids.some((id) => cur.results[id] && cur.results[id].s)) {
      toast.error("Mark at least one point before saving.");
      return;
    }
    if (v.odometer != null && odo < Number(v.odometer)) {
      if (!window.confirm(`The reading of ${fmtKm(odo)} is lower than the last recorded ${fmtKm(v.odometer)}. Save it anyway?`)) return;
    }
    setSaving(true);
    writeLocalDraft(cur);
    // Stop the server copy first, so a late draft write can't land after the save.
    doneRef.current = true;
    if (serverTimer.current) clearTimeout(serverTimer.current);
    serverTimer.current = null;
    await serverPut.current;
    try {
      const r = await fleetFetch<{ id: string }>("/api/vehicles/fleet/inspections", { body: { vehicleId: v.id, draft: cur } });
      removeLocalDraft(v.id);
      toast.success("Inspection saved.");
      router.push(`${FLEET}/inspections/${r.id}`);
    } catch (e) {
      doneRef.current = false;
      toast.error((e as Error).message);
      setSaving(false);
    }
  }

  async function discard() {
    if (!window.confirm("Discard this draft inspection? Uploaded photos in it will be lost.")) return;
    doneRef.current = true;
    if (serverTimer.current) clearTimeout(serverTimer.current);
    removeLocalDraft(v.id);
    await serverPut.current;
    await deleteServerDraft(v.id);
    router.push(vehicleHref(v.id));
  }

  // ── Pieces ──

  const pointFor = (id: string, inGuide: boolean) => {
    const it = ix[id];
    if (!it) return null;
    const r = d.results[id] || {};
    const open = d.open["i:" + id] ?? !!(r.n || (r.p && r.p.length));
    return (
      <Point
        key={id}
        it={it as PointItem}
        r={r}
        open={open}
        guided={inGuide}
        attn={props.attnByItem[id]}
        last={v.condition ? v.condition[id] : undefined}
        vehicleName={v.name}
        modelNote={props.modelNotes[id]}
        uploading={(uploading["item:" + id] || 0) > 0}
        onStatus={(s) => setStatus(id, s, inGuide)}
        onMeasure={(val) => setMeasure(id, val)}
        onNote={(n) =>
          update((x) => {
            const rr = x.results[id] || (x.results[id] = { p: [] });
            rr.n = n;
          })
        }
        onToggleMore={() => {
          update((x) => {
            x.open["i:" + id] = !open;
          });
          if (!open) setTimeout(() => (document.querySelector(`textarea[data-note="${CSS.escape(id)}"]`) as HTMLTextAreaElement | null)?.focus(), 60);
        }}
        onPhotos={(files) => upload("item:" + id, files)}
        onRemovePhoto={(pid) => removePhoto("item:" + id, pid)}
      />
    );
  };

  const slots = (
    <div className="grid grid-cols-2 gap-2">
      {SLOTS.map(([k]) => {
        const id = d.walk[k];
        const name = SLOTNAME[k];
        const busy = (uploading["walk:" + k] || 0) > 0;
        return (
          <div key={k} className="border border-rule">
            <div className="flex aspect-[4/3] items-center justify-center bg-bone text-[12px] text-[#55524A]">
              {busy ? (
                "Uploading…"
              ) : id ? (
                <a href={fileUrl(id)} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(id)} alt={name} className="h-full w-full object-cover" />
                </a>
              ) : (
                "No photo"
              )}
            </div>
            <div className="space-y-1 p-2">
              <p className="text-[13px] font-semibold leading-tight">{name}</p>
              <div className="flex flex-wrap gap-1">
                <UploadButton label={id ? "Replace" : "Add"} busy={busy} onFiles={(f) => upload("walk:" + k, f)} className="flex-1 px-2" />
                {id && (
                  <button type="button" onClick={() => removePhoto("walk:" + k, id)} className={cn(btnOutline, "px-2")}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const extraPhotos = (
    <div className="mt-4 space-y-2">
      <span className="mono-label">Other photos</span>
      <Thumbs ids={d.extra} caption="Extra photo" onRemove={(pid) => removePhoto("extra", pid)} />
      <UploadButton label="Add photos" multiple busy={(uploading.extra || 0) > 0} onFiles={(f) => upload("extra", f)} />
    </div>
  );

  const summaryField = (label: string, placeholder?: string) => (
    <label className="grid gap-1.5" htmlFor="f-summary">
      <span className="mono-label">{label}</span>
      <textarea
        id="f-summary"
        rows={4}
        value={d.summary}
        placeholder={placeholder}
        onChange={(e) => update((x) => void (x.summary = e.target.value))}
        className="w-full border border-rule-strong bg-white px-3 py-2 text-[16px] focus:border-ink focus:outline-none"
      />
    </label>
  );

  // ── Step by step ──

  const guidedCard = () => {
    const s = steps[step];
    const st = s.st !== undefined ? stageOf(s.st) : null;
    const stageNo = st ? stages.findIndex((y) => y.st === s.st) + 1 : 0;
    let body: React.ReactNode = null;
    if (s.k === "ready") {
      const n = steps.filter((x) => x.k === "item").length;
      body = (
        <div className="space-y-3 px-4 py-4 md:px-6">
          <h2 className="font-display text-[22px] font-black uppercase leading-tight">{stageOf(0).title}</h2>
          <p className="text-[15px] leading-relaxed">{stageOf(0).instructions}</p>
          {props.ready.length > 0 && (
            <div className="border border-rule bg-bone px-3 py-3">
              <h3 className="mono-label mb-2 !text-ink">On {v.name}</h3>
              <dl className="space-y-1.5 text-[14px]">
                {props.ready.map(([k, txt]) => (
                  <div key={k}>
                    <dt className="font-semibold">{k}</dt>
                    <dd>{txt}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <p className="text-[13px] text-[#55524A]">
            {n} points. Tap a result and the next point opens by itself. Monitor or Fix now opens a note: say what you saw and add a photo, then tap Next.
          </p>
        </div>
      );
    } else if (s.k === "attn") {
      body = (
        <div className="space-y-3 px-4 py-4 md:px-6">
          <h2 className="font-display text-[22px] font-black uppercase leading-tight">Keep an eye on</h2>
          <p className="text-[15px]">
            {v.name} has damage, recent repairs or problems on record. Give these extra attention today: each one shows up again on the step where you check it.
          </p>
          <AttentionList list={props.attention} ix={ix} />
        </div>
      );
    } else if (s.k === "photos") {
      body = (
        <div className="space-y-3 px-4 py-4 md:px-6">
          <h2 className="font-display text-[22px] font-black uppercase leading-tight">{st!.title}</h2>
          <p className="text-[15px]">{st!.instructions}</p>
          <h3 className="text-[15px] font-semibold">Walk-around photos</h3>
          <p className="text-[13px] text-[#55524A]">Stand back far enough to get the whole side in the picture.</p>
          {slots}
        </div>
      );
    } else if (s.k === "item") {
      body = (
        <div className="space-y-3 px-4 py-4 md:px-6">
          {s.first && st && (
            <div className="border-b border-rule pb-3">
              <h2 className="font-display text-[22px] font-black uppercase leading-tight">{st.title}</h2>
              <p className="text-[15px]">{st.instructions}</p>
            </div>
          )}
          {pointFor(s.id, true)}
        </div>
      );
    } else {
      const flagged = Object.entries(d.results).filter(([id, r]) => r && (r.s === "fix" || r.s === "mon") && ix[id] && inType(ix[id], type));
      const left = ids.filter((id) => !(d.results[id] || {}).s);
      body = (
        <div className="space-y-4 px-4 py-4 md:px-6">
          <h2 className="font-display text-[22px] font-black uppercase leading-tight">Finish</h2>
          {left.length ? (
            <p className="border-l-4 border-amber-border bg-bone-2 px-3 py-2 text-[14px]">
              {plural(left.length, "point")} not checked yet: {left.slice(0, 6).map((id) => ix[id].t).join(", ")}
              {left.length > 6 ? "…" : ""}. They keep their previous result.
            </p>
          ) : (
            <p className="text-[15px]">All points checked.</p>
          )}
          {flagged.length > 0 && (
            <div>
              <h3 className="mb-1 text-[15px] font-semibold">Flagged today</h3>
              <ul className="divide-y divide-rule border-y border-rule">
                {flagged.map(([id, r]) => (
                  <li key={id} className="flex items-start gap-2 py-2 text-[14px]">
                    <span className="min-w-0 flex-1 break-words">
                      {ix[id].t}
                      {r.n ? ": " + r.n : ""}
                    </span>
                    <StatusPill tone={STATE_TONE[r.s!]}>{STATUS[r.s!]}</StatusPill>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summaryField("Overall condition and what should happen next")}
          {extraPhotos}
          <p className="text-[13px] text-[#55524A]">
            Then tap <strong>Save</strong> at the bottom.
          </p>
        </div>
      );
    }
    const top =
      s.k === "ready"
        ? "Get ready"
        : s.k === "attn"
          ? "Before you start"
          : s.k === "finish"
            ? "Finish"
            : `Stage ${stageNo} of ${stages.length} · ${st!.title}`;
    return (
      <section ref={gcardRef} className="scroll-mt-16 border-b border-ink">
        <div className="section-bar">
          <span className="section-bar-title min-w-0 truncate">{top}</span>
          <span className="section-bar-meta">
            Step {step + 1} of {steps.length}
          </span>
        </div>
        {body}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-rule px-4 py-3 md:px-6">
          <button type="button" className={btnOutline} disabled={step === 0} onClick={() => gotoStep(step - 1)}>
            Back
          </button>
          <select
            aria-label="Jump to a stage"
            className={cn(field, "min-w-0 text-[14px]")}
            value=""
            onChange={(e) => {
              if (e.target.value !== "") gotoStep(Number(e.target.value));
            }}
          >
            <option value="">Jump to…</option>
            {stages.map((y) => (
              <option key={y.st} value={y.n}>
                {stageOf(y.st).title}
              </option>
            ))}
            <option value={steps.length - 1}>Finish</option>
          </select>
          {step < steps.length - 1 ? (
            <button type="button" className={btnSolid} onClick={() => gotoStep(step + 1)}>
              Next
            </button>
          ) : (
            <span />
          )}
        </div>
      </section>
    );
  }

  // ── Full list ──

  const fullList = () => {
    let first = true;
    return (
      <>
        {cl.sections.map((sec) => {
          const items = sec.items.filter((it) => inType(it, type));
          if (!items.length) return null;
          const open = d.open[sec.id] !== undefined ? d.open[sec.id] : first || !ROUTINE.includes(type);
          first = false;
          const n = items.filter((it) => d.results[it.id] && d.results[it.id].s).length;
          return (
            <details
              key={sec.id}
              open={open}
              onToggle={(e) => {
                const o = (e.currentTarget as HTMLDetailsElement).open;
                if (o !== open) update((x) => void (x.open[sec.id] = o));
              }}
              className="border-b border-rule"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 bg-bone px-4 py-2 md:px-6">
                <h2 className="font-display text-[17px] font-black uppercase">{sec.name}</h2>
                <span className={cn("font-mono text-[11px] font-bold tabular-nums", n === items.length ? "text-grass-text" : "text-[#55524A]")}>
                  {n} / {items.length}
                </span>
              </summary>
              {items.length > 2 && (
                <div className="flex justify-end border-b border-rule px-4 py-2 md:px-6">
                  <button
                    type="button"
                    className={btnOutline}
                    onClick={() =>
                      update((x) => {
                        for (const it of items) {
                          if (it.m) continue;
                          const r = x.results[it.id] || (x.results[it.id] = { p: [] });
                          if (!r.s) r.s = "ok";
                        }
                      })
                    }
                  >
                    Mark the rest OK
                  </button>
                </div>
              )}
              {items.map((it) => pointFor(it.id, false))}
            </details>
          );
        })}
        <Panel title="Summary">
          {summaryField(type === "workshop" ? "What the workshop recommends" : "Overall condition and what should happen next", SUMMARY_PH[type])}
          {extraPhotos}
        </Panel>
      </>
    );
  }

  return (
    <div onClickCapture={tick} onInputCapture={tick}>
      <Masthead
        context={`Fleet · ${v.name}`}
        title={`New ${t.label.toLowerCase()}`}
        actions={
          type !== "workshop" ? (
            <div className="grid grid-cols-2" role="group" aria-label="How to show the checks">
              {(
                [
                  ["guided", "Step by step"],
                  ["list", "Full list"],
                ] as const
              ).map(([m, l]) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={(m === "guided") === guided}
                  onClick={() => setMode(m)}
                  className={cn(btn, "-ml-px first:ml-0", (m === "guided") === guided ? "border-ink bg-ink text-white" : "border-ink bg-white text-ink")}
                >
                  {l}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2 text-[14px] md:px-6">
        <span className="font-semibold">{v.name}</span>
        <Plate reg={v.reg} />
      </div>

      <Panel>
        <fieldset>
          <legend className="mono-label mb-2">Inspection type</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {TYPES.map((x) => (
              <label
                key={x.id}
                className={cn(
                  "flex min-h-11 cursor-pointer gap-3 border px-3 py-2.5",
                  type === x.id ? "border-ink bg-bone" : "border-rule-strong bg-white"
                )}
              >
                <input
                  type="radio"
                  name="itype"
                  value={x.id}
                  checked={type === x.id}
                  onChange={() => update((dd) => void (dd.type = x.id as InspType))}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#0A0A0A]"
                />
                <span className="min-w-0">
                  <b className="block text-[15px]">{x.label}</b>
                  <span className="block text-[12px] leading-snug text-[#55524A]">
                    {itemsFor(cl, x.id).length} points. {x.desc}.
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5" htmlFor="f-date">
            <span className="mono-label">Date</span>
            <input id="f-date" type="date" max={today} value={d.date} onChange={(e) => update((x) => void (x.date = e.target.value))} className={field} />
          </label>
          <label className="grid gap-1.5" htmlFor="f-odo">
            <span className="mono-label">Odometer (km)</span>
            <input
              id="f-odo"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 182340"
              value={d.odometer}
              onChange={(e) => update((x) => void (x.odometer = e.target.value))}
              className={field}
            />
            <span className="text-[12px] text-[#55524A]">
              {v.odometer != null
                ? "Last recorded: " + fmtKm(v.odometer) + (v.odometerDate ? " on " + fmtDate(v.odometerDate) : "")
                : "No reading recorded yet"}
            </span>
          </label>
          <label className="grid gap-1.5" htmlFor="f-fuel">
            <span className="mono-label">Fuel level</span>
            <select id="f-fuel" value={d.fuel} onChange={(e) => update((x) => void (x.fuel = e.target.value))} className={field}>
              <option value="">Not recorded</option>
              {FUEL.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5" htmlFor="f-insp">
            <span className="mono-label">{type === "workshop" ? "Recorded by" : "Inspected by"}</span>
            <input
              id="f-insp"
              type="text"
              autoComplete="name"
              placeholder="Name of the person checking"
              value={d.inspector}
              onChange={(e) => update((x) => void (x.inspector = e.target.value))}
              className={field}
            />
          </label>
          {type === "post" && (
            <label className="grid gap-1.5" htmlFor="f-trip">
              <span className="mono-label">Trip or booking</span>
              <select id="f-trip" value={d.bookingId} onChange={(e) => update((x) => void (x.bookingId = e.target.value))} className={field}>
                <option value="">Not linked to a booking</option>
                {props.trips.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {type === "workshop" && (
            <label className="grid gap-1.5" htmlFor="f-prov">
              <span className="mono-label">Workshop</span>
              <select id="f-prov" value={d.provider} onChange={(e) => update((x) => void (x.provider = e.target.value))} className={field}>
                {["", ...props.providers, ...(d.provider && !props.providers.includes(d.provider) ? [d.provider] : [])].map((p) => (
                  <option key={p} value={p}>
                    {p || "Choose the workshop"}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Panel>

      {type === "workshop" && (
        <Panel title="Workshop report">
          <p className="mb-3 text-[13px] text-[#55524A]">Attach the mechanic’s report or job card, then record their findings point by point below.</p>
          {d.docs.length ? (
            <ul className="mb-3 space-y-1.5">
              {d.docs.map((f, i) => (
                <li key={f.id + i} className="flex flex-wrap items-center gap-2 text-[14px]">
                  <a href={fileUrl(f.id)} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all underline">
                    {(f.type || "").startsWith("image/") ? `Photo: ${f.name || "image"}` : f.name || "Document"}
                  </a>
                  <button type="button" className={cn(btnOutline, "min-h-9")} onClick={() => update((x) => void x.docs.splice(i, 1))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-[13px] text-[#55524A]">Nothing attached yet.</p>
          )}
          <UploadButton label="Add report (PDF or photo)" accept="image/*,application/pdf" multiple busy={(uploading.docs || 0) > 0} onFiles={(f) => upload("docs", f)} />
        </Panel>
      )}

      {!guided && type !== "pre" && type !== "workshop" && props.attention.length > 0 && (
        <Panel title="Keep an eye on">
          <p className="mb-2 text-[13px] text-[#55524A]">Give these extra attention today. Each one also shows on the point where you check it.</p>
          <AttentionList list={props.attention} ix={ix} />
        </Panel>
      )}
      {!guided && type !== "pre" && (
        <Panel title="Walk-around photos">
          <p className="mb-3 text-[13px] text-[#55524A]">
            The same six photos each time make it easy to compare the vehicle’s condition{type === "post" ? " before and after a trip" : " over time"}.
          </p>
          {slots}
        </Panel>
      )}

      <div className="border-b border-rule px-4 py-3 md:px-6" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span>
            {prog.done} of {prog.total} points checked{soFar ? ` · ${fmtMins(soFar)} so far` : ""}
          </span>
          <span className="flex gap-1.5">
            {prog.fix > 0 && <StatusPill tone="bad">{prog.fix} fix now</StatusPill>}
            {prog.mon > 0 && <StatusPill tone="warn">{prog.mon} monitor</StatusPill>}
          </span>
        </div>
        <div className="mt-2 h-1.5 bg-bone-3">
          <div className="h-full bg-ink" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} />
        </div>
      </div>

      {guided ? guidedCard() : fullList()}

      {/* Lifted above the phone tab bar; the matching bottom margin stops the lift from
          covering the end of the step (its Back / Next buttons). */}
      <div className="sticky bottom-[calc(62px+env(safe-area-inset-bottom,0px))] z-30 mb-[calc(62px+env(safe-area-inset-bottom,0px))] border-t border-ink bg-white px-4 py-2 md:bottom-0 md:mb-0 md:px-6">
        <p className="mb-2 text-[11px] leading-tight text-[#55524A]" id="save-note">
          {saveNote(prog.done, prog.total)}
        </p>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" className={btnOutline} onClick={discard} disabled={saving}>
            Discard draft
          </button>
          <button type="button" className={btnSolid} onClick={save} disabled={saving}>
            {saving ? "Saving…" : `Save ${t.short.toLowerCase()} check`}
          </button>
        </div>
      </div>
    </div>
  );
}
