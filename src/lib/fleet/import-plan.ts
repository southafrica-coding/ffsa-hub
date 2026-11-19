// The one-off import of the FFSA Fleet app's export (vehicles-module/seed) into the Hub's
// tables, as a pure plan: what to write, matched to the Hub's vehicles by registration.
// scripts/fleet-import.ts reads the files, calls this, and writes the rows. SPEC section 9.

import { randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Seed = {
  fleet: Record<string, Row>;
  records: Record<string, Row>;
  trips: Record<string, Row>;
  odometer?: Record<string, Row>;
  timelog?: Record<string, Row>;
  inspections?: Record<string, Row>;
  providers: Record<string, Row>;
  config: { checklist?: Row; schedule?: Row; notify?: Row };
  files: { id: string; file: string; contentType: string; usedBy: string[] }[];
};

export interface HubVehicle {
  id: string;
  name: string;
  registration_plate: string | null;
}
export interface HubBooking {
  id: string;
  booking_name: string;
  checkout_date: string;
  return_date: string;
  status: string;
  vehicle_ids: string[];
}
export interface Existing {
  /** legacy_id → id of rows already imported (so a re-run updates instead of duplicating). */
  providers: Record<string, string>;
  visits: Record<string, string>;
  files: Set<string>;
}

export const normReg = (r?: string | null) => String(r || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const nul = (v: unknown) => (v === "" || v === undefined ? null : v);
const fileOwner = (usedBy: string[]): { owner_type: string | null; owner_legacy: string | null } => {
  const first = usedBy[0] || "";
  let m = first.match(/^Photo of vehicle (\S+)/);
  if (m) return { owner_type: "vehicle", owner_legacy: m[1] };
  m = first.match(/^Workshop visit (\S+)/);
  if (m) return { owner_type: "visit", owner_legacy: m[1] };
  return { owner_type: null, owner_legacy: null };
};

export function planFleetImport(seed: Seed, hubVehicles: HubVehicle[], hubBookings: HubBooking[], existing: Existing) {
  const warnings: string[] = [];
  const byReg = new Map(hubVehicles.map((v) => [normReg(v.registration_plate), v]));

  // Vehicles: match by registration
  const vehicleId: Record<string, string> = {};
  const matches: { legacy: string; name: string; reg: string; hubId: string | null; hubName: string | null }[] = [];
  for (const [legacy, v] of Object.entries(seed.fleet)) {
    const hub = byReg.get(normReg(v.reg)) || null;
    matches.push({ legacy, name: v.name, reg: v.reg, hubId: hub?.id ?? null, hubName: hub?.name ?? null });
    if (hub) vehicleId[legacy] = hub.id;
    else warnings.push(`No Hub vehicle with registration ${v.reg} (${v.name}): left out. Add it under Manage fleet, then run the import again.`);
  }

  // Workshops
  const providerId: Record<string, string> = {};
  const providerByName: Record<string, string> = {};
  const providers = Object.entries(seed.providers).map(([legacy, p]) => {
    const id = existing.providers[legacy] || randomUUID();
    providerId[legacy] = id;
    providerByName[String(p.name).toLowerCase()] = id;
    return {
      id,
      legacy_id: legacy,
      name: p.name,
      services: nul(p.services),
      phone: nul(p.phone),
      phone2: nul(p.phone2),
      email: nul(p.email),
      website: nul(p.website),
      address: nul(p.address),
      hours: nul(p.hours),
      notes: nul(p.notes),
    };
  });

  // Workshop visits
  const visitId: Record<string, string> = {};
  for (const legacy of Object.keys(seed.records)) visitId[legacy] = existing.visits[legacy] || randomUUID();
  const visits = Object.entries(seed.records)
    .filter(([legacy, r]) => {
      if (vehicleId[r.vehicleId]) return true;
      warnings.push(`Workshop visit ${legacy} is for ${r.vehicleId}, which wasn't matched: left out.`);
      return false;
    })
    .map(([legacy, r]) => ({
      id: visitId[legacy],
      legacy_id: legacy,
      vehicle_id: vehicleId[r.vehicleId],
      status: r.status,
      kind: r.kind,
      date: r.date,
      until: nul(r.until),
      provider_id: providerByName[String(r.provider || "").toLowerCase()] || null,
      provider: nul(r.provider),
      odometer_km: nul(r.odometer),
      cost: nul(r.cost),
      ref: nul(r.ref),
      description: nul(r.description),
      work: r.work || [],
      warranty_until: nul(r.warrantyUntil),
      checked_by: nul(r.checkedBy),
      files: r.files || [],
      next_date: nul(r.nextDate),
      next_km: nul(r.nextKm),
      created_at: r.createdAt || undefined,
    }));

  // Vehicle details (the Hub's vehicles row keeps registration, make/model, fuel, seats)
  const assign: Record<string, number> = (seed.config.schedule?.assign as Record<string, number>) || {};
  const details = Object.entries(seed.fleet)
    .filter(([legacy]) => vehicleId[legacy])
    .map(([legacy, v]) => {
      const fu = v.followUp ? { ...v.followUp, recId: v.followUp.recId ? visitId[v.followUp.recId] || null : null } : null;
      return {
        vehicle_id: vehicleId[legacy],
        legacy_id: legacy,
        make: nul(v.make),
        model: nul(v.model),
        profile: nul(v.profile),
        year: nul(v.year),
        colour: nul(v.colour),
        transmission: nul(v.transmission),
        vin: nul(v.vin),
        engine_no: nul(v.engineNo),
        insurer: nul(v.insurer),
        policy_no: nul(v.policyNo),
        tracker: nul(v.tracker),
        base: nul(v.base),
        photo_file_id: nul(v.photo),
        fleet_status: v.status || "In service",
        status_since: nul(v.statusSince),
        licence_expiry: nul(v.licenceExpiry),
        odometer_km: nul(v.odometer),
        odometer_date: nul(v.odometerDate),
        odo_prev: v.odoPrev ?? null,
        last_service: v.lastService ?? null,
        last_b2b: v.lastB2B ?? null,
        service_km: nul(v.serviceKm),
        service_months: nul(v.serviceMonths),
        inspection_day: assign[legacy] ?? nul(v.inspectionDay),
        tyres: nul(v.tyres),
        where_text: nul(v.where),
        watch: v.watch || [],
        condition: v.condition || {},
        last_inspection: v.lastInspection ?? null,
        last_check: v.lastCheck ?? null,
        last_monthly: v.lastMonthly ?? null,
        last_post: v.lastPost ?? null,
        card_printed: v.cardPrinted ?? null,
        follow_up: fu,
        notes: nul(v.notes),
        sort_order: v.sort ?? 0,
      };
    });

  // Files: keep the ids; owner = the first thing that uses it
  const files = seed.files.map((f) => {
    const o = fileOwner(f.usedBy);
    const owner_id = o.owner_type === "vehicle" ? vehicleId[o.owner_legacy || ""] : o.owner_type === "visit" ? visitId[o.owner_legacy || ""] : null;
    return {
      row: { id: f.id, path: `import/${f.file}`, content_type: f.contentType, owner_type: o.owner_type, owner_id: owner_id ?? null, name: null },
      source: f.file,
      exists: existing.files.has(f.id),
    };
  });

  // Settings
  const sch = seed.config.schedule || {};
  const settings = {
    id: "global",
    days: sch.days ?? [2, 3, 4],
    max_per_day: sch.maxPerDay ?? 2,
    budget_hours: sch.budgetHours ?? 5,
    weekly_only: sch.weeklyOnly ?? [],
    checklist: seed.config.checklist ?? null,
    notify: { email: !!seed.config.notify?.email, slack: !!seed.config.notify?.slack },
  };

  // Trips and rentals are never imported: Hub bookings replace them, and Gideon will
  // upload the bookings himself later (18 Nov 2026). They're only listed, for reference.
  const tripReport = Object.entries(seed.trips).map(([legacy, t]) => {
    const vid = vehicleId[t.vehicleId];
    const match = hubBookings.find(
      (b) => vid && b.vehicle_ids.includes(vid) && ["approved", "completed", "pending"].includes(b.status) && b.checkout_date <= t.from && b.return_date >= t.to
    );
    return { legacy, vehicle: seed.fleet[t.vehicleId]?.name ?? t.vehicleId, from: t.from, to: t.to, label: t.label, booking: match ? `${match.booking_name} (${match.status})` : null };
  });
  for (const t of tripReport)
    if (!t.booking) warnings.push(`${t.vehicle}: ${t.label} ${t.from} – ${t.to} is in the old app only and is not imported (bookings are uploaded separately).`);

  // Km readings and time log (empty in the 17 Nov 2026 export; a later export may have some)
  const odometer = Object.values(seed.odometer || {})
    .filter((o) => vehicleId[o.vehicleId] && Number(o.km) > 0 && o.date)
    .map((o) => ({ vehicle_id: vehicleId[o.vehicleId], km: Number(o.km), date: o.date, note: nul(o.note), source: o.source || "km-log" }));
  const timelog = Object.values(seed.timelog || {})
    .filter((t) => t.date && Number(t.mins) > 0)
    .map((t) => ({ date: t.date, week: t.week, kind: t.kind, type: nul(t.type), vehicle_id: vehicleId[t.vehicleId] || null, mins: Math.round(Number(t.mins)) }));
  const inspections = Object.keys(seed.inspections || {}).length;
  if (inspections)
    warnings.push(`The export has ${inspections} inspection(s). Importing inspections isn't built yet (there were none on 17 Nov 2026): ask for it before go-live, or they'll be missing.`);

  return { matches, providers, details, visits, files, settings, odometer, timelog, tripReport, warnings };
}
