// One-off importer for the FFSA OKR Google Sheet.
//
//   npx tsx scripts/import-okrs.ts --inspect          list every block in the sheet
//   npx tsx scripts/import-okrs.ts --dry-run          parse + resolve, write nothing
//   npx tsx scripts/import-okrs.ts --cycle=2026 --author=<uuid>
//   ...add --reset to clear that cycle's objectives first
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
//
// WHY A MANIFEST. The sheet is one flat export of many tabs, and most
// ministries appear TWICE — an older block and a reworked one — with no field
// saying which is current. Guessing would silently import last year's plan over
// this year's. So nothing is imported unless scripts/data/okrs-manifest.json
// names the block explicitly, by the line it starts on. Run --inspect, decide,
// then fill the manifest in.
//
// The sheet is block-structured, not tabular: a "Ministry Name:" row, then
// "OBJECTIVE n" rows, then "KR n.m" rows, and the Progress/Notes columns sit at
// a different index in every block because each tab has its own width and its
// own merged-cell spans. So the column index is read off each block's own
// "Key Result #" header row, never assumed.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

import { lossyStatusNote, mapStatus, parseSheet } from "../src/lib/okrs/sheet-parser";

/* ── CLI ─────────────────────────────────────────────── */

const args = process.argv.slice(2);
const flag = (name: string) => args.some((a) => a === `--${name}`);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const INSPECT = flag("inspect");
const DRY_RUN = flag("dry-run");
const RESET = flag("reset");
const CYCLE_SLUG = opt("cycle") ?? "2026";
const AUTHOR_ID = opt("author");

const SHEET = resolve(__dirname, "data/okrs-sheet.md");
const MANIFEST = resolve(__dirname, "data/okrs-manifest.json");

/* ── Main ────────────────────────────────────────────── */

interface PendingKeyResult {
  objectiveId: string;
  position: number;
  label: string;
  description: string;
  notes: string | null;
  timeline: string | null;
  status: string;
  seedsCheckin: boolean;
  checkinComment: string | null;
}
/** Key results are inserted after their objectives, in one pass. */
const pending: PendingKeyResult[] = [];


interface ManifestEntry {
  line: number;
  /** Exactly one of ministrySlug / teamSlug — see okr_objectives_owner_group_ck. */
  ministrySlug?: string;
  teamSlug?: string;
  subcategory?: string;
  note?: string;
}

async function main() {
  if (!existsSync(SHEET)) {
    console.error(`Sheet extract not found at ${SHEET}`);
    process.exit(1);
  }

  const { blocks, skipped } = parseSheet(readFileSync(SHEET, "utf-8"));

  if (INSPECT) {
    console.log(`${blocks.length} blocks found. Copy the lines you want into the manifest.\n`);
    for (const b of blocks) {
      const krs = b.objectives.reduce((n, o) => n + o.keyResults.length, 0);
      console.log(
        `  line ${String(b.line).padStart(5)}  ${b.sheetLabel.slice(0, 26).padEnd(28)} ` +
          `${String(b.objectives.length).padStart(2)} objectives, ${String(krs).padStart(3)} key results` +
          `   first: ${b.objectives[0]?.title.slice(0, 50) ?? "(none)"}`
      );
    }
    if (skipped.length > 0) {
      console.log(`\n${skipped.length} rows the parser did not recognise:`);
      for (const s of skipped.slice(0, 20)) console.log(`  ${s}`);
      if (skipped.length > 20) console.log(`  ...and ${skipped.length - 20} more`);
    }
    return;
  }

  if (!existsSync(MANIFEST)) {
    console.error(
      `No manifest at ${MANIFEST}.\n` +
        `Most ministries appear twice in the sheet and nothing says which block is current,\n` +
        `so this importer refuses to guess. Run --inspect, then list the blocks to import.`
    );
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as ManifestEntry[];
  if (manifest.length === 0) {
    console.error("The manifest is empty — nothing to import.");
    process.exit(1);
  }

  const byLine = new Map(blocks.map((b) => [b.line, b]));
  const missing = manifest.filter((e) => !byLine.has(e.line));
  if (missing.length > 0) {
    console.error("Manifest names lines that are not block headings:");
    for (const m of missing) console.error(`  line ${m.line} (${m.ministrySlug})`);
    process.exit(1);
  }

  // Status vocabulary is checked BEFORE anything is written, across every
  // selected block — a single unrecognised word aborts, rather than quietly
  // landing 400 key results as "not started".
  const unknownStatuses = new Set<string>();
  for (const entry of manifest) {
    for (const o of byLine.get(entry.line)!.objectives) {
      for (const kr of o.keyResults) {
        if (mapStatus(kr.progress) === null) unknownStatuses.add(kr.progress);
      }
    }
  }
  if (unknownStatuses.size > 0) {
    console.error("Progress values the importer does not recognise — add them to STATUS_MAP:");
    for (const s of unknownStatuses) console.error(`  "${s}"`);
    process.exit(1);
  }

  const env = loadEnv();
  const supabase = createClient(env.url, env.key);

  const { data: cycle } = await supabase
    .from("okr_cycles")
    .select("id, name, slug, starts_on")
    .eq("slug", CYCLE_SLUG)
    .maybeSingle();
  if (!cycle) {
    console.error(`No OKR cycle with slug "${CYCLE_SLUG}". Apply migration 182 first.`);
    process.exit(1);
  }

  const { data: ministries } = await supabase.from("staff_ministries").select("id, name, slug");
  const ministryBySlug = new Map(
    ((ministries ?? []) as { id: string; slug: string }[]).map((m) => [m.slug, m.id])
  );

  const { data: teams } = await supabase.from("okr_teams").select("id, name, slug");
  const teamBySlug = new Map(
    ((teams ?? []) as { id: string; slug: string }[]).map((t) => [t.slug, t.id])
  );

  // Exactly one owning group per entry, matching the database constraint.
  const badOwner = manifest.filter((e) => !e.ministrySlug === !e.teamSlug);
  if (badOwner.length > 0) {
    console.error("Every manifest entry needs exactly one of ministrySlug or teamSlug:");
    for (const b of badOwner) console.error(`  line ${b.line} — ${b.note ?? ""}`);
    process.exit(1);
  }

  // A missing group aborts the run. Creating a staff ministry here would have
  // side effects — the leadership_team role trigger keys off the slug, and the
  // Ministry nav keys off membership — so that decision belongs to a person.
  const unmapped = manifest.filter((e) =>
    e.teamSlug ? !teamBySlug.has(e.teamSlug) : !ministryBySlug.has(e.ministrySlug!)
  );
  if (unmapped.length > 0) {
    console.error("Manifest names groups that do not exist:");
    for (const u of unmapped) {
      console.error(`  ${u.teamSlug ?? u.ministrySlug} (sheet line ${u.line})`);
    }
    console.error("\nMinistries:", [...ministryBySlug.keys()].join(", "));
    console.error("OKR teams: ", [...teamBySlug.keys()].join(", "));
    process.exit(1);
  }

  // Subcategories, where a sheet block is really a sub-team of a ministry.
  const { data: subs } = await supabase
    .from("staff_ministry_subcategories")
    .select("id, name, staff_ministry_id");
  const subRows = (subs ?? []) as { id: string; name: string; staff_ministry_id: string }[];

  const existing = await supabase
    .from("okr_objectives")
    .select("id", { count: "exact", head: true })
    .eq("cycle_id", cycle.id);
  const existingCount = existing.count ?? 0;

  if (existingCount > 0 && !RESET && !DRY_RUN) {
    console.error(
      `The ${cycle.name} cycle already has ${existingCount} objectives. ` +
        `Re-run with --reset to replace them, or pick another cycle.`
    );
    process.exit(1);
  }

  if (!DRY_RUN && !AUTHOR_ID) {
    console.error("--author=<user uuid> is required: every seeded check-in needs an author.");
    process.exit(1);
  }

  /* Plan the work, then either print it or do it. */

  let objectiveCount = 0;
  let keyResultCount = 0;
  let checkinCount = 0;
  const dropped: string[] = [];

  if (!DRY_RUN && RESET && existingCount > 0) {
    // CASCADE clears key results and their check-ins with them.
    await supabase.from("okr_objectives").delete().eq("cycle_id", cycle.id);
    console.log(`Cleared ${existingCount} existing objectives from the ${cycle.name} cycle.`);
  }

  for (const entry of manifest) {
    const block = byLine.get(entry.line)!;
    const ministryId = entry.ministrySlug ? ministryBySlug.get(entry.ministrySlug)! : null;
    const teamId = entry.teamSlug ? teamBySlug.get(entry.teamSlug)! : null;

    if (entry.subcategory && !ministryId) {
      console.error(
        `Line ${entry.line}: a subcategory only exists under a ministry, and this entry names a team.`
      );
      process.exit(1);
    }

    const subcategoryId =
      entry.subcategory && ministryId
        ? subRows.find(
            (s) =>
              s.staff_ministry_id === ministryId &&
              s.name.toLowerCase() === entry.subcategory!.toLowerCase()
          )?.id ?? null
        : null;

    if (entry.subcategory && !subcategoryId) {
      console.error(
        `No subcategory "${entry.subcategory}" under ${entry.ministrySlug} (sheet line ${entry.line}).`
      );
      process.exit(1);
    }

    for (const o of block.objectives) {
      if (o.title.trim() === "") {
        dropped.push(`line ${block.line}: objective ${o.position} has no title`);
        continue;
      }

      objectiveCount += 1;
      let objectiveId: string | null = null;

      if (!DRY_RUN) {
        const { data, error } = await supabase
          .from("okr_objectives")
          .insert({
            cycle_id: cycle.id,
            scope: "ministry",
            staff_ministry_id: ministryId,
            okr_team_id: teamId,
            subcategory_id: subcategoryId,
            position: o.position,
            title: o.title,
            created_by: AUTHOR_ID,
          })
          .select("id")
          .single();
        if (error) {
          console.error(`Failed to insert objective "${o.title.slice(0, 40)}": ${error.message}`);
          process.exit(1);
        }
        objectiveId = data!.id;
      }

      o.keyResults.forEach((kr, index) => {
        // description is NOT NULL and an empty KR row carries no information —
        // these are the sheet's blank placeholders.
        if (kr.description.trim() === "") {
          dropped.push(`line ${block.line}: ${kr.label} has no description`);
          return;
        }
        keyResultCount += 1;
        const status = mapStatus(kr.progress)!;
        const seedsCheckin = kr.progress.trim() !== "";
        const lossy = lossyStatusNote(kr.progress);
        if (seedsCheckin) checkinCount += 1;

        if (DRY_RUN) return;

        pending.push({
          objectiveId: objectiveId!,
          position: index + 1,
          label: kr.label,
          description: kr.description,
          notes: kr.notes || null,
          timeline: kr.timeline || null,
          status,
          seedsCheckin,
          checkinComment: [lossy, kr.notes || null].filter(Boolean).join(" ") || null,
        });
      });
    }
  }

  if (!DRY_RUN) {
    for (const p of pending) {
      const { data, error } = await supabase
        .from("okr_key_results")
        .insert({
          objective_id: p.objectiveId,
          position: p.position,
          label: p.label,
          description: p.description,
          notes: p.notes,
          timeline: p.timeline,
          created_by: AUTHOR_ID,
        })
        .select("id")
        .single();
      if (error) {
        console.error(`Failed to insert key result ${p.label}: ${error.message}`);
        process.exit(1);
      }

      // current_status is never written directly — inserting the check-in lets
      // the okr_checkins_refresh_kr trigger set it, the same way the app does.
      if (p.seedsCheckin) {
        const { error: ciErr } = await supabase.from("okr_checkins").insert({
          key_result_id: data!.id,
          checkin_on: cycle.starts_on,
          status: p.status,
          comment: p.checkinComment,
          author_id: AUTHOR_ID,
        });
        if (ciErr) {
          console.error(`Failed to seed check-in for ${p.label}: ${ciErr.message}`);
          process.exit(1);
        }
      }
    }
  }

  console.log(
    `\n${DRY_RUN ? "DRY RUN — nothing written" : "Imported"} into the ${cycle.name} cycle:\n` +
      `  blocks      ${manifest.length}\n` +
      `  objectives  ${objectiveCount}\n` +
      `  key results ${keyResultCount}\n` +
      `  check-ins   ${checkinCount}`
  );

  if (dropped.length > 0) {
    console.log(`\n${dropped.length} rows dropped (empty, nothing to import):`);
    for (const d of dropped) console.log(`  ${d}`);
  }
  if (skipped.length > 0) {
    console.log(`\n${skipped.length} sheet rows the parser did not recognise (not imported):`);
    for (const s of skipped.slice(0, 15)) console.log(`  ${s}`);
    if (skipped.length > 15) console.log(`  ...and ${skipped.length - 15} more`);
  }
}

function loadEnv(): { url: string; key: string } {
  const envFile = readFileSync(resolve(__dirname, "../.env.local"), "utf-8");
  const env: Record<string, string> = {};
  for (const line of envFile.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      let value = match[2].trim().replace(/^["']|["']$/g, "");
      value = value.replace(/\\n$/, "");
      env[match[1].trim()] = value;
    }
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  return { url, key };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
