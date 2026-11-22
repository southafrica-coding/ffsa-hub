// ============================================================
// Ops: make the 20 Missio weekly feedback links (Hub Forms F4)
// ============================================================
// DO NOT RUN AGAINST PROD UNTIL JACK OKs IT. Previews share the prod
// database. Run the seed script (seed_missio_weekly_feedback.ts) first.
//
// What it does: one missio_feedback_links row per Missio house, using
// the same code as a pastor's "Copy the leader's link" button
// (houseFeedbackLink). A house that already has a link keeps it, so
// running it twice makes nothing new and prints the same links. It never
// rotates a link.
//
// It does nothing at all unless MISSIO_FEEDBACK_LINKS_ENABLED=1
// (src/lib/forms/flags.ts). Set that only in the shell that runs this,
// never in Vercel.
//
//   MISSIO_FEEDBACK_LINKS_ENABLED=1 node --conditions=react-server --import tsx \
//     supabase/scripts/ops/generate_missio_feedback_links.ts --project-ref=<ref> [--i-have-approval-for-prod]
//
// (--conditions=react-server lets the app's "server-only" modules load
// outside Next.) Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// and MISSIO_AVAILABILITY_TOKEN_SECRET (the same secret as live, or the
// links will not open). The links are written to a local file named on
// the command line (--out=links.csv), never to the console: they are
// keys to each house's form. Send each one to its house's leaders only.
// ============================================================

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkImportWriteGate } from "../../../src/lib/missio/house-church-import";
import { generateWeeklyFeedbackLinks } from "../../../src/lib/missio/feedback-links";
import { createAdminClient } from "../../../src/lib/supabase/admin";

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
  const projectRef = argv.find((a) => a.startsWith("--project-ref="))?.split("=")[1] ?? null;
  const out = argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null;
  const approveProd = argv.includes("--i-have-approval-for-prod");

  const gate = checkImportWriteGate({ apply: true, projectRef, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, approveProd });
  if (!gate.ok) {
    console.error(gate.error);
    process.exit(1);
  }
  if (!out) {
    console.error("Pass --out=<file> for the links (they are never printed).");
    process.exit(1);
  }

  const result = await generateWeeklyFeedbackLinks(createAdminClient());
  if (result.status === "off") {
    console.log("Off: MISSIO_FEEDBACK_LINKS_ENABLED is not 1. Nothing done.");
    return;
  }
  if (result.status === "no_org") {
    console.error("No Missio organisation found.");
    process.exit(1);
  }
  const site = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";
  writeFileSync(out, ["house,link", ...result.links.map((l) => `${l.number},${site}${l.path}`)].join("\n") + "\n", { mode: 0o600 });
  console.log(`${result.links.length} links written to ${out}.${result.failed.length ? ` Failed: houses ${result.failed.join(", ")}.` : ""}`);
}

void main();
