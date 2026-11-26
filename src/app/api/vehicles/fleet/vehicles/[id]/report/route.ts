import { NextResponse } from "next/server";
import { bad, fleetAuth, isIsoDate, isUuid } from "@/lib/fleet/api";
import { loadFleet } from "@/lib/fleet/load";
import { inspectionFromRow } from "@/lib/fleet/inspection";
import { buildVehicleReport, reportFileName, type ReportFix, type ReportVisit } from "@/lib/fleet/report";
import { renderVehicleReportPdf } from "@/lib/fleet/report-pdf";
import { getFleetFixes, getFleetInspections, getFleetOdometerReadings } from "@/services/fleet";

/* eslint-disable @typescript-eslint/no-explicit-any */

// GET /api/vehicles/fleet/vehicles/[id]/report?from=YYYY-MM-DD&to=YYYY-MM-DD — the
// vehicle's history report as a PDF (Gideon, 23 Nov 2026): workshop visits (services,
// repairs, inspections at the workshop) with costs, inspections and what they found,
// fixes, bookings and km readings in the period, plus a summary and the issues open now.
// Anyone who can see Fleet. Built fresh each time; nothing is stored. Hidden ("deleted")
// records aren't in it (359).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return bad("Unknown vehicle");
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (!isIsoDate(from) || !isIsoDate(to)) return bad("Choose the dates the report is for.");
  if (from > to) return bad("The start date is after the end date.");

  const { F, vehicleRows } = await loadFleet(auth.supabase);
  const v = F.vehicles.find((x) => x.id === id);
  if (!v) return bad("Unknown vehicle", 404);
  const row: any = vehicleRows.find((r) => r.id === id);
  const details: any = row && (Array.isArray(row.details) ? row.details[0] : row.details);

  const [insp, odo, fixes] = await Promise.all([
    getFleetInspections(auth.supabase, { vehicleId: id }),
    getFleetOdometerReadings(auth.supabase, id),
    getFleetFixes(auth.supabase, id, { from, to }),
  ]);
  for (const r of [insp, odo]) if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  // Fixes (358): until that migration is applied, the report just has none.
  if (fixes.error) console.error("[fleet report] fixes", fixes.error.message);

  const report = buildVehicleReport({
    vehicle: { name: v.name, reg: v.reg, make: v.make, model: v.model, year: v.year, colour: v.colour, vin: details?.vin || null },
    from,
    to,
    inspections: ((insp.data ?? []) as any[]).map(inspectionFromRow),
    visits: F.visits.filter((r) => r.vehicleId === id) as ReportVisit[],
    fixes: fixes.error
      ? []
      : ((fixes.data ?? []) as any[]).map((r): ReportFix => ({ date: r.fixed_on, point: r.point, by: r.fixed_by, work: r.work, was: r.was || {} })),
    readings: ((odo.data ?? []) as any[]).map((r) => ({ date: r.date, km: Number(r.km), note: r.note || "" })),
    trips: F.trips.filter((t) => t.vehicleId === id),
    condition: v.condition,
    checklist: F.checklist,
    today: F.today,
  });

  const pdf = await renderVehicleReportPdf(report);
  const fileName = reportFileName(v.reg, v.name, from, to);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
