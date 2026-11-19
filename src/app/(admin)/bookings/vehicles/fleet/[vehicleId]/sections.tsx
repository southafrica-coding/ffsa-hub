// The vehicle page's tabs (the Fleet app's overviewTab, conditionTab, historyTab,
// photosTab, manualTab). Server components; the interactive parts are client islands.

import Link from "next/link";
import { SectionBar, StatusPill } from "@/components/ffsa";
import { STATUS, fmtDate, fmtDay, fmtKm, has, tripName, typeOf, type Alert, type CardState, type FleetVehicle, type ISODate } from "@/lib/fleet/rules";
import { cn } from "@/lib/utils/cn";
import { FLEET, SevDot, fileUrl, sevLabel, vehicleHref } from "../_components/ui";
import { ago, fmtR } from "../vehicles/model";
import { ClearFollowUpButton } from "./header-client";
import { EditDetailsButton, type EditableVehicle } from "./vehicle-dialog";
import { VisitButton, type VisitCtx } from "./visit-dialog";
import { WatchPanel, type WatchPanelProps } from "./watch-panel";
import {
  ATT_LABEL,
  WORK_CHECK,
  inspectionMeta,
  markRows,
  type CondFilter,
  type CondRow,
  type HistoryItem,
  type KeyDate,
  type ManualPoint,
  type PhotoGroup,
  type Visit,
  type conditionView,
  type manualStages,
  type recentTrips,
} from "./model";

const pad = "px-5 md:px-8";
const linkSm = "inline-flex min-h-11 items-center whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-[0.12em] underline";
const RES_TONE: Record<string, "good" | "warn" | "bad" | "quiet"> = { ok: "good", mon: "warn", fix: "bad", na: "quiet" };
const inspHref = (id: string) => `${FLEET}/inspections/${id}`;

function Kv({ rows }: { rows: { k: string; v: React.ReactNode | null; muted?: string }[] }) {
  return (
    <dl className="divide-y divide-rule">
      {rows.map((r) => (
        <div key={r.k} className={cn("grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-4", pad)}>
          <dt className="mono-label">{r.k}</dt>
          <dd className="min-w-0 break-words text-[14px]">
            {r.v === null || r.v === "" ? (
              r.muted ? <span className="text-[#7C786C]">{r.muted}</span> : <span className="text-[#7C786C]">Not captured</span>
            ) : (
              <>
                {r.v}
                {r.muted && <span className="text-[#7C786C]"> {r.muted}</span>}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CountPills({ c }: { c: Record<string, number> | null }) {
  if (!c) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {c.fix ? <StatusPill tone="bad">{c.fix} fix now</StatusPill> : null}
      {c.mon ? <StatusPill tone="warn">{c.mon} monitor</StatusPill> : null}
      <StatusPill tone="good">{c.ok || 0} OK</StatusPill>
      {c.na ? <StatusPill tone="quiet">{c.na} N/A</StatusPill> : null}
    </span>
  );
}

function FileLink({ f }: { f: { id: string; name?: string; type?: string } }) {
  const img = (f.type || "").startsWith("image/");
  return (
    <a href={fileUrl(f.id)} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center border border-rule-strong px-3 text-[13px] underline-offset-2 hover:underline">
      {img ? `Photo: ${f.name || "image"}` : f.name || "Document"}
    </a>
  );
}

function Thumbs({ ids, cap }: { ids?: string[]; cap: string }) {
  if (!ids || !ids.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <a key={id} href={fileUrl(id)} target="_blank" rel="noopener" className="block h-16 w-16 overflow-hidden border border-rule">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the Fleet files route */}
          <img src={fileUrl(id)} alt={cap} loading="lazy" className="h-full w-full object-cover" />
        </a>
      ))}
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────

export function OverviewTab({
  v,
  alerts,
  booked,
  keyDates,
  watch,
  trips,
  details,
  notes,
  ctx,
  canWrite,
}: {
  v: FleetVehicle;
  alerts: Alert[];
  booked: Visit[];
  keyDates: KeyDate[];
  watch: WatchPanelProps;
  trips: ReturnType<typeof recentTrips>;
  details: [string, string | null][];
  notes: string | null;
  ctx: VisitCtx;
  canWrite: boolean;
}) {
  const fu = v.followUp;
  return (
    <>
      <div className="grid md:grid-cols-2 md:divide-x md:divide-rule">
        <section aria-label="To do">
          <SectionBar title="To do" />
          {alerts.length ? (
            <ul className="divide-y divide-rule">
              {alerts.map((a, i) => (
                <li key={i} className={cn("flex gap-3 py-2 text-[14px] leading-snug", pad)}>
                  <SevDot sev={a.sev} className="mt-3.5" />
                  <span className="min-w-0 flex-1 py-1.5">
                    <span className="sr-only">{sevLabel(a.sev)}: </span>
                    {a.text}
                  </span>
                  {a.tab && (
                    <Link href={`${vehicleHref(v.id, a.tab)}${a.tab === "condition" ? "&f=issues" : ""}`} className={linkSm}>
                      View
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={cn("py-3 text-[14px] text-[#55524A]", pad)}>Nothing due or flagged.</p>
          )}
          {booked.length > 0 ? (
            <>
              <h3 className={cn("mono-label border-t border-rule pb-1 pt-4", pad)}>Booked at the workshop</h3>
              <ul className="divide-y divide-rule">
                {booked.map((r) => (
                  <li key={r.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[14px]", pad)}>
                    <SevDot sev="warn" className="mt-0" />
                    <span className="min-w-0 flex-1">
                      {[r.kind, r.provider].filter(has).join(", ")} · {fmtDay(r.date)}
                    </span>
                    {canWrite && (
                      <VisitButton ctx={ctx} mode="outcome" visit={r}>
                        Record the outcome
                      </VisitButton>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            fu &&
            (fu.date || has(fu.km)) &&
            canWrite && (
              <p className={cn("border-t border-rule py-3 text-[13px]", pad)}>
                Follow-up: {[fu.kind, fu.date ? fmtDate(fu.date) : "", has(fu.km) ? "at " + fmtKm(fu.km) : ""].filter(has).join(", ")}.{" "}
                <ClearFollowUpButton vehicleId={v.id} />
              </p>
            )
          )}
        </section>
        <section aria-label="Key dates">
          <SectionBar title="Key dates" />
          <Kv
            rows={keyDates.map((d) => ({
              k: d.k,
              v: d.v === null ? null : d.expired ? (
                <>
                  {d.v} <StatusPill tone="bad">Expired</StatusPill>
                </>
              ) : (
                d.v
              ),
              muted: d.muted,
            }))}
          />
        </section>
      </div>

      <WatchPanel {...watch} />

      <section aria-label="Trips and rentals">
        <SectionBar title="Trips and rentals" />
        {canWrite && (
          <div className={cn("pt-3", pad)}>
            <Link
              href="/bookings/vehicles/new"
              className="inline-flex min-h-11 items-center border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone"
            >
              Add trip or rental
            </Link>
          </div>
        )}
        {trips.length ? (
          <ul className="divide-y divide-rule">
            {trips.map((t) => (
              <li key={t.id} className={cn("flex gap-3 py-3 text-[14px]", pad)}>
                <span aria-hidden className={cn("mt-1.5 h-2.5 w-2.5 shrink-0", t.when === "now" ? "bg-ink" : t.when === "soon" ? "bg-amber-border" : "bg-rule")} />
                <span className="min-w-0">
                  <b>{tripName(t)}</b> · {fmtDay(t.from)} – {fmtDay(t.to)} {t.source === "hub" && <StatusPill>From FFSA Hub</StatusPill>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={cn("py-3 text-[14px] text-[#55524A]", pad)}>
            No trips or rentals booked. While a vehicle is away its weekly check is postponed, and you’re reminded to do a pre-trip check before it leaves and a post-trip check when it’s back.
          </p>
        )}
      </section>

      <section aria-label="Vehicle details">
        <SectionBar title="Vehicle details" />
        <Kv rows={details.map(([k, val]) => ({ k, v: val }))} />
        {notes && <p className={cn("whitespace-pre-line border-t border-rule bg-bone py-3 text-[14px]", pad)}>{notes}</p>}
      </section>
    </>
  );
}

// ── Condition ──────────────────────────────────────────────

export function ConditionTab({ vehicleId, view, f, today }: { vehicleId: string; view: ReturnType<typeof conditionView>; f: CondFilter; today: ISODate }) {
  return (
    <div className="pb-6">
      <p className={cn("pt-4 text-[13px] text-[#55524A]", pad)}>The latest recorded result for each point, from any inspection.</p>
      <div role="group" aria-label="Filter" className={cn("flex flex-wrap gap-2 py-3", pad)}>
        {view.chips.map(([k, l, n]) => (
          <Link
            key={k}
            href={`${vehicleHref(vehicleId, "condition")}${k === "all" ? "" : "&f=" + k}`}
            aria-pressed={f === k}
            aria-current={f === k ? "true" : undefined}
            className={cn("chip min-h-11", f === k && "!border-ink !bg-ink !text-white")}
          >
            {l} ({n})
          </Link>
        ))}
      </div>
      {view.sections.length ? (
        view.sections.map((sec) => (
          <section key={sec.name}>
            <h3 className={cn("border-y border-rule bg-bone py-2 font-display text-[14px] font-black uppercase tracking-[0.04em]", pad)}>{sec.name}</h3>
            <ul className="divide-y divide-rule">
              {sec.rows.map((row) => (
                <ConditionRow key={row.id} row={row} today={today} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className={cn("py-3 text-[14px] text-[#55524A]", pad)}>{view.empty}</p>
      )}
    </div>
  );
}

function ConditionRow({ row, today }: { row: CondRow; today: ISODate }) {
  const r = row.r;
  const s = r && r.s;
  return (
    <li className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-3 sm:grid-cols-[96px_1fr_auto]", pad)}>
      <span>
        <StatusPill tone={s ? RES_TONE[s] : "quiet"}>{s ? STATUS[s] : "Not checked"}</StatusPill>
      </span>
      <div className="min-w-0">
        <span className="text-[14px]">{row.t}</span>
        {r && has(r.v) && (
          <span className="ml-2 font-display text-[15px] font-black tabular-nums">
            {String(r.v)} {row.unit}
          </span>
        )}
        {r && r.n && <p className="mt-0.5 text-[13px] text-[#55524A]">{r.n}</p>}
        <Thumbs ids={r?.p} cap={row.t} />
      </div>
      <span className="col-start-2 text-[12px] sm:col-start-auto sm:text-right">
        {r && r.d ? (
          r.i ? (
            <Link href={inspHref(r.i)} className="underline">
              {ago(r.d, today)}
            </Link>
          ) : (
            ago(r.d, today)
          )
        ) : (
          <StatusPill>{row.tag}</StatusPill>
        )}
      </span>
    </li>
  );
}

// ── History ────────────────────────────────────────────────

export function HistoryTab({ items, ctx, canWrite }: { items: HistoryItem[]; ctx: VisitCtx; canWrite: boolean }) {
  if (!items.length)
    return (
      <p className={cn("py-5 text-[14px] text-[#55524A]", pad)}>
        No inspections or workshop visits recorded yet.{canWrite ? " Start with a monthly check, or log the last service from the service book." : ""}
      </p>
    );
  return (
    <ol className="divide-y divide-rule border-b border-rule">
      {items.map((x) => (
        <li key={x.k + x.id}>{x.k === "i" ? <HistInspection x={x} /> : x.k === "o" ? <HistKm x={x} /> : <HistVisit x={x} ctx={ctx} canWrite={canWrite} />}</li>
      ))}
    </ol>
  );
}

const hHead = "flex flex-wrap items-baseline justify-between gap-x-3";
const hMeta = "text-[13px] text-[#55524A]";

function HistInspection({ x }: { x: Extract<HistoryItem, { k: "i" }> }) {
  return (
    <Link href={inspHref(x.id)} className={cn("block space-y-1.5 py-3 hover:bg-bone", pad)}>
      <div className={hHead}>
        <strong className="text-[15px]">{typeOf(x.type).label}</strong>
        <span className="text-[12px] text-[#7C786C]">{fmtDate(x.date)}</span>
      </div>
      {inspectionMeta(x) && <p className={hMeta}>{inspectionMeta(x)}</p>}
      <CountPills c={x.counts} />
    </Link>
  );
}

function HistKm({ x }: { x: Extract<HistoryItem, { k: "o" }> }) {
  return (
    <div className={cn("space-y-1 py-3", pad)}>
      <div className={hHead}>
        <strong className="text-[15px]">Km reading</strong>
        <span className="text-[12px] text-[#7C786C]">{fmtDate(x.date)}</span>
      </div>
      <p className={cn(hMeta, "tabular-nums")}>
        {fmtKm(x.km)}
        {x.note ? " · " + x.note : ""}
      </p>
    </div>
  );
}

function HistVisit({ x, ctx, canWrite }: { x: Extract<HistoryItem, { k: "r" }>; ctx: VisitCtx; canWrite: boolean }) {
  const booked = x.status === "booked";
  const work = x.work || [];
  const files = x.files || [];
  const meta = [x.provider, has(x.odometer) ? fmtKm(x.odometer) : "", has(x.cost) ? fmtR(x.cost) : "", x.ref ? "Ref " + x.ref : ""].filter(has).join(" · ");
  return (
    <div className={cn("space-y-1.5 py-3", pad)}>
      <div className={hHead}>
        <strong className="text-[15px]">{x.kind || "Workshop visit"}</strong>
        <span className="text-[12px] text-[#7C786C]">
          {booked ? "Booked for " : ""}
          {fmtDate(x.date)}
        </span>
      </div>
      {(booked || meta) && (
        <p className={cn(hMeta, "flex flex-wrap items-center gap-2")}>
          {booked && <StatusPill tone="warn">Booked</StatusPill>}
          {meta}
        </p>
      )}
      {x.description && <p className="whitespace-pre-line text-[14px]">{x.description}</p>}
      {work.length > 0 && (
        <ul className="divide-y divide-rule border-y border-rule">
          {work.map((w, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1">{w.d}</span>
              {has(w.cost) && <span className="tabular-nums text-[#55524A]">{fmtR(w.cost)}</span>}
              {w.chk && <StatusPill tone={w.chk === "ok" ? "good" : w.chk === "bad" ? "bad" : "quiet"}>{WORK_CHECK[w.chk] || ""}</StatusPill>}
            </li>
          ))}
        </ul>
      )}
      {(x.warrantyUntil || x.checkedBy) && (
        <p className={hMeta}>{[x.warrantyUntil ? "Warranty until " + fmtDate(x.warrantyUntil) : "", x.checkedBy ? "Checked by " + x.checkedBy : ""].filter(has).join(" · ")}</p>
      )}
      {(x.nextDate || has(x.nextKm)) && (
        <p className={hMeta}>Next due: {[x.nextDate ? fmtDate(x.nextDate) : "", has(x.nextKm) ? fmtKm(x.nextKm) : ""].filter(has).join(" or ")}</p>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <FileLink key={f.id} f={f} />
          ))}
        </div>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2 pt-1">
          {booked && (
            <VisitButton ctx={ctx} mode="outcome" visit={x} tone="solid">
              Record the outcome
            </VisitButton>
          )}
          <VisitButton ctx={ctx} mode="edit" visit={x}>
            Edit
          </VisitButton>
        </div>
      )}
    </div>
  );
}

// ── Photos ─────────────────────────────────────────────────

export function PhotosTab({ groups }: { groups: PhotoGroup[] }) {
  if (!groups.length)
    return (
      <p className={cn("py-5 text-[14px] text-[#55524A]", pad)}>
        No photos yet. Walk-around photos taken during inspections collect here, so you can compare the vehicle’s condition over time.
      </p>
    );
  return (
    <>
      {groups.map((g, gi) => (
        <section key={gi} className="pb-4">
          <h3 className={cn("border-y border-rule bg-bone py-2 font-display text-[14px] font-black uppercase tracking-[0.04em]", pad)}>
            {g.inspectionId ? (
              <Link href={inspHref(g.inspectionId)} className="underline">
                {g.title} · {fmtDate(g.date)}
              </Link>
            ) : (
              <>
                {g.title} · {fmtDate(g.date)}
              </>
            )}
          </h3>
          <div className={cn("grid grid-cols-2 gap-2 pt-3 sm:grid-cols-3 lg:grid-cols-4", pad)}>
            {g.ph.map((p, i) => (
              <a key={p.id + i} href={fileUrl(p.id)} target="_blank" rel="noopener" className="block border border-rule">
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the Fleet files route */}
                <img src={fileUrl(p.id)} alt={p.cap} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                <span className="block truncate px-2 py-1 text-[12px]">{p.cap}</span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ── Manual ─────────────────────────────────────────────────

const CARD_DOT: Record<CardState, "ok" | "info" | "warn"> = { ok: "ok", none: "info", stale: "warn", old: "warn" };

export function ManualTab({
  name,
  card,
  where,
  watch,
  stages,
  edit,
  canWrite,
}: {
  name: string;
  card: { st: CardState; text: string };
  where: [string, string][];
  watch: WatchPanelProps;
  stages: ReturnType<typeof manualStages>;
  edit: { vehicle: EditableVehicle; statuses: string[]; today: string };
  canWrite: boolean;
}) {
  return (
    <>
      <section aria-label="Print for the vehicle">
        <SectionBar title="Print for the vehicle" />
        <div className={cn("max-w-3xl space-y-3 py-4 text-[14px]", pad)}>
          <p>
            The <strong>in-car guide</strong> is for whoever drives the vehicle: the checks before driving and on return, where things are, and what to do in a breakdown. Print it,
            laminate it and keep it in the cubby hole. Replace it every 6 months, or sooner when the app says it’s out of date.
          </p>
          <p className="flex gap-2">
            <SevDot sev={CARD_DOT[card.st]} />
            <span>{card.text}</span>
          </p>
          <p className="text-[13px] text-[#55524A]">
            The in-car guide and the full manual can’t be downloaded from the Hub yet: the PDFs come in a later update.
          </p>
          <p className="text-[13px] text-[#55524A]">The full manual is for the vehicle coordinator: every check in detail, including this vehicle’s damage and recent repairs.</p>
        </div>
      </section>

      <section aria-label="Where things are on this vehicle">
        <SectionBar title="Where things are on this vehicle" />
        <Kv rows={where.map(([k, t]) => ({ k, v: t }))} />
        {canWrite && (
          <p className={cn("border-t border-rule py-1 text-[13px]", pad)}>
            Something missing or wrong? <EditDetailsButton {...edit} label="Edit the vehicle details" link /> (“On this vehicle”).
          </p>
        )}
      </section>

      <WatchPanel {...watch} />

      <section aria-label={`How to inspect ${name}`}>
        <SectionBar title={`How to inspect ${name}`} />
        <p className={cn("py-3 text-[13px] text-[#55524A]", pad)}>
          In the order you’d walk around the vehicle. Tap a point to read what it should look like, how to check it, and what can go wrong.
        </p>
        {stages.map((st) => (
          <section key={st.id} className="border-t border-ink">
            <h3 className={cn("pt-3 font-display text-[16px] font-black uppercase tracking-[0.04em]", pad)}>{st.t}</h3>
            <p className={cn("pb-2 text-[13px]", pad)}>{st.i}</p>
            <div className="divide-y divide-rule border-t border-rule">
              {st.points.map((p) => (
                <ManualItem key={p.id} p={p} name={name} />
              ))}
            </div>
          </section>
        ))}
      </section>
    </>
  );
}

function ManualItem({ p, name }: { p: ManualPoint; name: string }) {
  const h = p.help;
  const marks = markRows(h);
  return (
    <details className="group">
      <summary className={cn("flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 py-2.5 text-[14px] hover:bg-bone", pad)}>
        <span className="min-w-0 flex-1 basis-48">{p.t}</span>
        <span className="flex flex-wrap gap-1">
          {p.watch.length > 0 && <StatusPill tone="warn">Keep an eye on</StatusPill>}
          {p.tags.map((t) => (
            <StatusPill key={t}>{t}</StatusPill>
          ))}
        </span>
      </summary>
      <div className={cn("max-w-3xl space-y-3 pb-4 pt-1 text-[14px]", pad)}>
        {p.watch.length > 0 && (
          <div className="border-l-[3px] border-amber-border bg-bone px-3 py-2">
            {p.watch.map((a, i) => (
              <p key={i}>
                <strong>
                  {ATT_LABEL[a.k] || "Note"}
                  {a.d ? ` (${fmtDate(a.d)})` : ""}:
                </strong>{" "}
                {a.t}
              </p>
            ))}
          </div>
        )}
        {h.why && (
          <div>
            <h4 className="mono-label mb-1">Why it matters</h4>
            <p>{h.why}</p>
          </div>
        )}
        {h.safetyFirst && (
          <p>
            <strong>Safety first:</strong> {h.safetyFirst}
          </p>
        )}
        {h.looksLike && (
          <div>
            <h4 className="mono-label mb-1">What it should look like</h4>
            <p>{h.looksLike}</p>
          </div>
        )}
        {h.howToCheck && h.howToCheck.length > 0 && (
          <div>
            <h4 className="mono-label mb-1">How to check</h4>
            <ol className="list-decimal space-y-1 pl-5">
              {h.howToCheck.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          </div>
        )}
        {h.whatGoesWrong && h.whatGoesWrong.length > 0 && (
          <div>
            <h4 className="mono-label mb-1">What can go wrong, and the signs</h4>
            <dl className="space-y-1.5">
              {h.whatGoesWrong.map((w, i) => (
                <div key={i}>
                  <dt className="font-medium">{w.problem}</dt>
                  <dd className="text-[#55524A]">{w.signs}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {p.vehicleNote && (
          <p>
            <strong>On {name}:</strong> {p.vehicleNote}
          </p>
        )}
        {marks.length > 0 && (
          <div>
            <h4 className="mono-label mb-1">How to mark it</h4>
            <dl className="space-y-1.5">
              {marks.map(([k, l, t]) => (
                <div key={k} className="flex flex-wrap gap-2">
                  <dt>
                    <StatusPill tone={RES_TONE[k]}>{l}</StatusPill>
                  </dt>
                  <dd className="min-w-0 flex-1 basis-48">{t}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </details>
  );
}
