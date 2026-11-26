import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Masthead, StatusPill } from "@/components/ffsa";
import { loadFleet, requireFleet } from "@/lib/fleet/load";
import { inspectionFromRow, reportText, SLOTS, type Measure, type StoredResult } from "@/lib/fleet/inspection";
import { checklistIndex, fmtDate, fmtKm, fmtMins, fmtRange, has, itemsFor, STATUS, todayInSA, typeOf } from "@/lib/fleet/rules";
import { getFleetInspection } from "@/services/fleet";
import { Facts, FLEET, Plate, fileUrl, vehicleHref } from "../../_components/ui";
import { STATE_TONE, Thumbs } from "../../[vehicleId]/inspect/point";
import { InspectionActions } from "./inspection-actions";

// /bookings/vehicles/fleet/inspections/[id] — one inspection (the Fleet app's
// inspDetailView): odometer, fuel, inspector, points checked, time taken, walk-around
// photos, issues, all results, Copy report text and Delete.
export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { access } = await requireFleet(supabase);
  const { id } = await params;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const [{ data: row }, { F }] = await Promise.all([
    isUuid ? getFleetInspection(supabase, id) : Promise.resolve({ data: null }),
    loadFleet(supabase, todayInSA()),
  ]);

  if (!row) {
    return (
      <>
        <Masthead context="Fleet" title="Inspection not found" />
        <p className="px-5 py-6 text-[14px] md:px-8">
          It may have been deleted.{" "}
          <Link href={`${FLEET}/vehicles`} className="underline">
            All vehicles
          </Link>
        </p>
      </>
    );
  }

  const ins = inspectionFromRow(row);
  const v = F.vehicles.find((x) => x.id === ins.vehicleId) || { id: ins.vehicleId, name: "Removed vehicle", reg: null };
  const t = typeOf(ins.type);
  const cl = F.checklist;
  const ix = checklistIndex(cl);
  const res = ins.results || {};
  const unit = (iid: string) => {
    const m = ix[iid] && (ix[iid].m as Measure | undefined);
    return m ? " " + m.u : "";
  };
  const issues = Object.entries(res)
    .filter(([, r]) => r.s === "fix" || r.s === "mon")
    .sort((a, b) => (a[1].s === "fix" ? 0 : 1) - (b[1].s === "fix" ? 0 : 1));
  const checked = Object.values(res).filter((r) => r.s).length;
  const total = itemsFor(cl, t.id).length;
  const trip = ins.bookingId ? F.trips.find((x) => x.id.split(":")[0] === ins.bookingId) : null;
  const tripLabel = trip ? `${trip.label || "Trip"}, ${fmtRange(trip.from, trip.to)}` : "";

  const bySec: Record<string, [string, StoredResult][]> = {};
  for (const [iid, r] of Object.entries(res)) {
    const k = r.sec || (ix[iid] && ix[iid].secName) || "Other";
    (bySec[k] = bySec[k] || []).push([iid, r]);
  }
  const secOrder = cl.sections.map((s) => s.name);
  const secNames = Object.keys(bySec).sort((a, b) => (secOrder.indexOf(a) + 1 || 99) - (secOrder.indexOf(b) + 1 || 99));
  const c = ins.counts;

  const resultRow = (iid: string, r: StoredResult, withSec: boolean) => (
    <li key={iid} className="flex gap-3 px-4 py-3 md:px-6">
      <span className="w-[76px] shrink-0">
        {r.s ? <StatusPill tone={STATE_TONE[r.s]}>{STATUS[r.s]}</StatusPill> : <StatusPill tone="quiet">Note only</StatusPill>}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words text-[14px] font-medium">{r.t}</p>
        {has(r.v) && (
          <p className="font-display text-[18px] font-black tabular-nums">
            {r.v}
            {unit(iid)}
          </p>
        )}
        {r.n && <p className="break-words text-[14px] text-[#2B2A26]">{r.n}</p>}
        <Thumbs ids={r.p} caption={r.t} />
        {withSec && r.sec && <p className="mono-label">{r.sec}</p>}
      </div>
    </li>
  );

  const walk = SLOTS.filter(([k]) => ins.walk && ins.walk[k]);

  return (
    <>
      <Masthead
        context={`Fleet · ${v.name}`}
        title={`${t.label} · ${fmtDate(ins.date)}`}
        actions={
          <InspectionActions
            id={ins.id!}
            vehicleId={ins.vehicleId}
            report={reportText(ins, v, cl, tripLabel)}
            canDelete={access.canManage}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-2 text-[14px] md:px-8">
        <Link href={vehicleHref(v.id)} className="font-semibold underline underline-offset-4">
          {v.name}
        </Link>
        <Plate reg={v.reg} />
      </div>

      <section className="border-b border-rule">
        <Facts
          rows={[
            ["Odometer", <span key="o" className="tabular-nums">{fmtKm(ins.odometer)}</span>],
            ["Fuel level", ins.fuel || "Not recorded"],
            ["Inspected by", ins.inspector || "Not recorded"],
            ["Workshop", ins.provider],
            ["Trip", tripLabel],
            ["Points checked", `${checked} of ${total}`],
            ["Time taken", ins.mins !== null && ins.mins !== undefined ? fmtMins(ins.mins) : ""],
          ]}
        />
        <div className="flex flex-wrap gap-1.5 px-5 pb-4 md:px-8">
          {c.fix > 0 && <StatusPill tone="bad">{c.fix} fix now</StatusPill>}
          {c.mon > 0 && <StatusPill tone="warn">{c.mon} monitor</StatusPill>}
          <StatusPill tone="good">{c.ok || 0} OK</StatusPill>
          {c.na > 0 && <StatusPill tone="quiet">{c.na} N/A</StatusPill>}
        </div>
        {ins.summary && <p className="whitespace-pre-wrap break-words border-t border-rule px-5 py-4 text-[15px] md:px-8">{ins.summary}</p>}
      </section>

      {ins.docs.length > 0 && (
        <section className="border-b border-rule">
          <div className="section-bar">
            <span className="section-bar-title">{ins.type === "workshop" ? "Workshop report" : "Documents"}</span>
          </div>
          <ul className="space-y-1.5 px-5 py-4 md:px-8">
            {ins.docs.map((f) => (
              <li key={f.id}>
                <a href={fileUrl(f.id)} target="_blank" rel="noopener noreferrer" className="break-all text-[14px] underline">
                  {(f.type || "").startsWith("image/") ? `Photo: ${f.name || "image"}` : f.name || "Document"}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {walk.length > 0 && (
        <section className="border-b border-rule">
          <div className="section-bar">
            <span className="section-bar-title">Walk-around photos</span>
          </div>
          <div className="grid grid-cols-2 gap-2 px-5 py-4 md:grid-cols-3 md:px-8">
            {walk.map(([k, n]) => (
              <a key={k} href={fileUrl(ins.walk[k])} target="_blank" rel="noopener noreferrer" className="block border border-rule">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(ins.walk[k])} alt={n} loading="lazy" className="aspect-[4/3] w-full bg-bone object-cover" />
                <span className="block px-2 py-1.5 text-[13px] font-medium">{n}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="border-b border-rule">
        <div className="section-bar">
          <span className="section-bar-title">Issues found</span>
          {issues.length > 0 && <span className="section-bar-meta">{issues.length}</span>}
        </div>
        {issues.length ? (
          <ul className="divide-y divide-rule">{issues.map(([iid, r]) => resultRow(iid, r, true))}</ul>
        ) : (
          <p className="px-5 py-4 text-[14px] text-[#55524A] md:px-8">No points marked Monitor or Fix now.</p>
        )}
      </section>

      <section className="border-b border-rule">
        <div className="section-bar">
          <span className="section-bar-title">All results</span>
        </div>
        {secNames.map((sn) => (
          <details key={sn} className="border-b border-rule last:border-b-0">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 bg-bone px-4 py-2 md:px-6">
              <h3 className="font-display text-[16px] font-black uppercase">{sn}</h3>
              <span className="font-mono text-[11px] font-bold tabular-nums text-[#55524A]">{bySec[sn].length}</span>
            </summary>
            <ul className="divide-y divide-rule">{bySec[sn].map(([iid, r]) => resultRow(iid, r, false))}</ul>
          </details>
        ))}
      </section>

      {ins.extra.length > 0 && (
        <section className="border-b border-rule">
          <div className="section-bar">
            <span className="section-bar-title">Other photos</span>
          </div>
          <div className="px-5 py-4 md:px-8">
            <Thumbs ids={ins.extra} caption="Extra photo" />
          </div>
        </section>
      )}
    </>
  );
}
