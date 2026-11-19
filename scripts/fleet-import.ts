#!/usr/bin/env node
// One-off import of the FFSA Fleet app's export (vehicles-module/seed) into Fleet.
// For Jack to run by hand AFTER migrations 350–353 are applied. Nothing in the app
// runs this. SPEC section 9; the plan itself is src/lib/fleet/import-plan.ts (tested).
//
//   SUPABASE_URL=https://<test-project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<that project's service role key> \
//   FLEET_TEST_PROJECT_REF=<test-project> \
//   npx tsx scripts/fleet-import.ts                 # dry run: prints the plan, writes nothing
//
//   ... npx tsx scripts/fleet-import.ts --apply      # writes to the test project
//   ... npx tsx scripts/fleet-import.ts --apply --production   # go-live only (Jack)
//   ... --seed <folder>                              # a fresh export (default vehicles-module/seed)
//
// Safety:
//   • It does NOT read .env.local (which normally points at the live Hub): the URL and key
//     must be given in the environment for this run.
//   • --apply writes only when the URL's project ref equals FLEET_TEST_PROJECT_REF, or when
//     --production is passed as well.
//   • Vehicles are matched by registration; unmatched ones are left out with a warning.
//   • Trips and rentals are not imported: Hub bookings replace them, and the bookings are
//     uploaded separately later. The old app's are only listed, for reference.
//   • Safe to run twice: rows are matched by their Fleet app id (legacy_id), files by id.
//     Km readings and time logs are only added while those tables are empty.
//   • Never deletes anything, never prints the key.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { planFleetImport, type HubBooking } from "../src/lib/fleet/import-plan";

const BUCKET = "fleet-files";
const ROOT = path.resolve(__dirname, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const readJson = (dir: string, f: string, fallback: unknown = {}) =>
  existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), "utf8")) : fallback;

async function main() {
  const apply = process.argv.includes("--apply");
  const production = process.argv.includes("--production");
  const seedDir = path.resolve(arg("--seed") || path.join(ROOT, "vehicles-module/seed"));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment for this run (not in .env.local).\n" +
        "Use the TEST project's values. The key is in Supabase → Project Settings → API; it is never printed."
    );
    process.exit(1);
  }
  const ref = new URL(url).hostname.split(".")[0];
  const testRef = process.env.FLEET_TEST_PROJECT_REF;
  console.log(`Target: ${ref}${testRef && ref === testRef ? " (test project)" : ""}  ·  seed: ${path.relative(process.cwd(), seedDir)}  ·  ${apply ? "APPLY" : "dry run"}`);
  if (apply && !production && ref !== testRef) {
    console.error(
      `\nRefusing to write: ${ref} is not FLEET_TEST_PROJECT_REF (${testRef || "not set"}).\n` +
        "Set FLEET_TEST_PROJECT_REF to the test project's ref, or pass --production at go-live."
    );
    process.exit(1);
  }

  const seed = {
    fleet: readJson(seedDir, "db/fleet.json"),
    records: readJson(seedDir, "db/records.json"),
    trips: readJson(seedDir, "db/trips.json"),
    providers: readJson(seedDir, "db/providers.json"),
    odometer: readJson(seedDir, "db/odometer.json"),
    timelog: readJson(seedDir, "db/timelog.json"),
    inspections: readJson(seedDir, "db/inspections.json"),
    config: readJson(seedDir, "db/config.json"),
    files: readJson(seedDir, "files/index.json", []),
  };

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data as T;
  };

  const vehicles = must(await sb.from("vehicles").select("id, name, registration_plate"), "read vehicles");
  const bookingRows = must(
    await sb
      .from("vehicle_bookings")
      .select("id, booking_name, checkout_date, return_date, status, assignments:vehicle_booking_assignments(vehicle_id)")
      .gte("return_date", "2026-01-01"),
    "read bookings"
  ) as { id: string; booking_name: string; checkout_date: string; return_date: string; status: string; assignments: { vehicle_id: string }[] }[];
  const bookings: HubBooking[] = bookingRows.map((b) => ({ ...b, vehicle_ids: (b.assignments || []).map((a) => a.vehicle_id) }));
  const prov = must(await sb.from("fleet_providers").select("id, legacy_id"), "read fleet_providers (are migrations 350–353 applied?)") as { id: string; legacy_id: string }[];
  const vis = must(await sb.from("fleet_workshop_visits").select("id, legacy_id"), "read fleet_workshop_visits") as { id: string; legacy_id: string }[];
  const fil = must(await sb.from("fleet_files").select("id"), "read fleet_files") as { id: string }[];

  const plan = planFleetImport(seed, vehicles, bookings, {
    providers: Object.fromEntries(prov.filter((p) => p.legacy_id).map((p) => [p.legacy_id, p.id])),
    visits: Object.fromEntries(vis.filter((v) => v.legacy_id).map((v) => [v.legacy_id, v.id])),
    files: new Set(fil.map((f) => f.id)),
  });

  console.log("\nVehicles (matched by registration):");
  for (const m of plan.matches) console.log(`  ${m.reg.padEnd(11)} ${m.name.padEnd(16)} → ${m.hubName ?? "NOT FOUND"}`);
  console.log(`\nWorkshops: ${plan.providers.length} · workshop visits: ${plan.visits.length} · files: ${plan.files.length} (${plan.files.filter((f) => !f.exists).length} new)`);
  console.log(`Km readings: ${plan.odometer.length} · time log: ${plan.timelog.length} · checklist: ${plan.settings.checklist ? "yes" : "no"}`);
  console.log("\nTrips and rentals in the export (not imported; bookings are uploaded separately):");
  for (const t of plan.tripReport) console.log(`  ${t.vehicle}: ${t.label} ${t.from} – ${t.to} → ${t.booking ?? "not a Hub booking yet"}`);
  if (plan.warnings.length) console.log("\nWarnings:\n" + plan.warnings.map((w) => "  • " + w).join("\n"));

  if (!apply) {
    console.log("\nDry run: nothing written. Add --apply to write.");
    return;
  }

  must(await sb.from("fleet_providers").upsert(plan.providers, { onConflict: "legacy_id" }), "write workshops");
  must(await sb.from("fleet_vehicle_details").upsert(plan.details, { onConflict: "vehicle_id" }), "write vehicle details");
  must(await sb.from("fleet_workshop_visits").upsert(plan.visits, { onConflict: "id" }), "write workshop visits");

  for (const f of plan.files) {
    if (f.exists) continue;
    const buf = readFileSync(path.join(seedDir, "files", f.source));
    const up = await sb.storage.from(BUCKET).upload(f.row.path, buf, { contentType: f.row.content_type, upsert: false });
    if (up.error && !/exists/i.test(up.error.message)) throw new Error(`upload ${f.source}: ${up.error.message}`);
    must(await sb.from("fleet_files").insert({ ...f.row, size_bytes: buf.length }), `file row ${f.row.id}`);
  }

  must(await sb.from("fleet_settings").upsert(plan.settings, { onConflict: "id" }), "write settings");

  const odoCount = (await sb.from("fleet_odometer_readings").select("id", { count: "exact", head: true })).count ?? 0;
  if (plan.odometer.length && odoCount === 0) must(await sb.from("fleet_odometer_readings").insert(plan.odometer), "write km readings");
  const tlCount = (await sb.from("fleet_time_logs").select("id", { count: "exact", head: true })).count ?? 0;
  if (plan.timelog.length && tlCount === 0) must(await sb.from("fleet_time_logs").insert(plan.timelog), "write time log");

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("\nImport failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
