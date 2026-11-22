// ============================================================
// Ops: seed the Missio weekly feedback form (Hub Forms F4)
// ============================================================
// DO NOT RUN AGAINST PROD UNTIL JACK OKs IT. This is not a migration:
// previews share the prod database, so the form row stays out of
// numbered migrations. Needs migrations 390 and 391 applied first.
//
// What it does: writes ONE public.forms row, slug
// "missio-weekly-feedback", from the template in
// src/lib/forms/templates/missio-weekly-feedback.ts (kind
// missio_weekly_feedback, access token, subject house, active). If the
// row is already there it updates the same row (schema, name, kind,
// access, subject), so running it twice changes nothing the second
// time. It never touches submissions, feedback rows or links.
//
// Until this row exists, the house links and the house page show
// "Opens soon" and nothing saves.
//
// Dry run (default, reads only):
//   npx tsx supabase/scripts/ops/seed_missio_weekly_feedback.ts
// Write, only when --project-ref matches NEXT_PUBLIC_SUPABASE_URL:
//   SEED_MISSIO_WEEKLY_FEEDBACK=1 npx tsx supabase/scripts/ops/seed_missio_weekly_feedback.ts \
//     --apply --project-ref=<ref>
// The production ref also needs --i-have-approval-for-prod.
//
// Uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local).
// Prints no secrets.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkImportWriteGate } from "../../../src/lib/missio/house-church-import";
import {
  MISSIO_WEEKLY_FEEDBACK_SLUG,
  missioWeeklyFeedbackFormRow,
} from "../../../src/lib/forms/templates/missio-weekly-feedback";

function loadLocalEnv() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (!match || process.env[match[1].trim()]) continue;
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // The process environment is enough.
  }
}

async function main() {
  loadLocalEnv();
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const projectRef = argv.find((a) => a.startsWith("--project-ref="))?.split("=")[1] ?? null;
  const approveProd = argv.includes("--i-have-approval-for-prod");

  if (apply && process.env.SEED_MISSIO_WEEKLY_FEEDBACK !== "1") {
    console.error("Refusing to write: set SEED_MISSIO_WEEKLY_FEEDBACK=1 as well (only after Jack OKs it).");
    process.exit(1);
  }
  const gate = checkImportWriteGate({ apply, projectRef, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, approveProd });
  if (!gate.ok) {
    console.error(gate.error);
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const row = missioWeeklyFeedbackFormRow();

  const found = await db.from("forms").select("id, kind, is_active").eq("slug", MISSIO_WEEKLY_FEEDBACK_SLUG).maybeSingle();
  if (found.error) {
    console.error("Read failed:", found.error.message);
    process.exit(1);
  }
  const questions = row.schema.steps.reduce((n, s) => n + s.fields.length, 0);
  console.log(found.data ? `Form exists (${found.data.id}); would update it.` : "No form yet; would insert it.");
  console.log(`Template: ${row.schema.steps.length} sections, ${questions} questions.`);
  if (!apply) {
    console.log("Dry run. Nothing written.");
    return;
  }

  const write = found.data
    ? await db.from("forms").update(row).eq("id", found.data.id).select("id").single()
    : await db.from("forms").insert(row).select("id").single();
  if (write.error) {
    console.error("Write failed:", write.error.message);
    process.exit(1);
  }
  console.log(`Done: ${write.data.id}`);
}

void main();
