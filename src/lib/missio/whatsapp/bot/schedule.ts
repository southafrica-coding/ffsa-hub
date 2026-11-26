// ────────────────────────────────────────────────────────────
// Missio WhatsApp menu — running bot work after the webhook's 200
// ────────────────────────────────────────────────────────────
// Server only. The webhook verifies the signature, stores the message and
// moves the thread on, then hands the new messages here and answers Meta
// at once. next/server `after()` runs the menu once the response is sent,
// so Graph is never called inside the webhook request and a Sunday burst
// can't time Meta out into retries.
//
// Order: jobs run oldest first, one at a time per thread (createThreadQueue);
// different threads run side by side. Sends share one service-role limiter
// (BOT_MAX_CONCURRENT_SENDS), separate from the pastors' composer bucket.
//
// If 397 isn't applied the bot tables are missing: the claim fails, the
// error is logged without detail, and nothing is sent. The inbox is unaffected.

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendConfig } from "../config";
import { approvedTemplates } from "../server";
import { WhatsAppNotInstalledError } from "../store";
import { supabaseLeadersFor, supabaseWhatsAppStore } from "../supabase-store";
import { processBotJob, type BotDeps } from "./engine";
import { createLimiter, createThreadQueue } from "./limiter";
import type { BotJob } from "./types";

export const BOT_MAX_CONCURRENT_SENDS = 4;

const limiter = createLimiter(BOT_MAX_CONCURRENT_SENDS);
const threadQueue = createThreadQueue();

function liveDeps(): BotDeps {
  const admin = createAdminClient();
  const config = sendConfig();
  return {
    store: supabaseWhatsAppStore(admin),
    config,
    limiter,
    notify: {
      loadTemplates: () => (config ? approvedTemplates(config) : Promise.resolve({ ok: false as const })),
      leadersFor: supabaseLeadersFor(admin),
    },
  };
}

/** Answer each job, oldest first, in order per thread. Never throws. */
export async function runBotJobs(jobs: readonly BotJob[], deps: BotDeps = liveDeps()): Promise<void> {
  const ordered = [...jobs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  await Promise.all(
    ordered.map((job) =>
      threadQueue
        .run(job.threadId, () => processBotJob(deps, job))
        .catch((error: unknown) => {
          if (error instanceof WhatsAppNotInstalledError) {
            console.error("[missio-whatsapp-bot] not installed (397); nothing sent");
          } else {
            console.error("[missio-whatsapp-bot] job failed", error instanceof Error ? error.message : "unknown");
          }
        })
    )
  );
}

/** Called by the webhook route after the store, before it answers 200. */
export function scheduleBotWork(jobs: readonly BotJob[]): void {
  if (jobs.length === 0 || !sendConfig()) return;
  try {
    after(() => runBotJobs(jobs));
  } catch {
    // Outside a request (shouldn't happen in the route): drop rather than block the 200.
    console.error("[missio-whatsapp-bot] couldn't schedule bot work");
  }
}
