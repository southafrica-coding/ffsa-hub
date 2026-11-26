import "server-only";
import { missioFeedbackLinksEnabled } from "@/lib/forms/flags";
import { houseFeedbackLink } from "@/lib/missio/feedback";

// ============================================================
// The 20 weekly feedback links (Hub Forms F4) — OFF
// ============================================================
// One link per Missio house, made with the same code a pastor's "copy
// link" button uses (houseFeedbackLink): a house that already has a
// link keeps it, so running this twice changes nothing. It never
// rotates a link.
//
// Off unless MISSIO_FEEDBACK_LINKS_ENABLED is on (flags.ts) and this is
// not a preview. Off returns before any database read. Only the ops
// script (supabase/scripts/ops/generate_missio_feedback_links.ts) calls
// it, and only after Jack OKs it.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type LinkRow = { number: number; houseId: string; path: string };

export type LinksResult =
  | { status: "off"; links: [] }
  | { status: "no_org"; links: [] }
  | { status: "done"; links: LinkRow[]; failed: number[] };

export async function generateWeeklyFeedbackLinks(
  db: Db,
  opts: { createdBy?: string | null; env?: NodeJS.ProcessEnv } = {}
): Promise<LinksResult> {
  if (!missioFeedbackLinksEnabled(opts.env ?? process.env)) return { status: "off", links: [] };

  const org = await db.from("organisations").select("id").eq("slug", "missio").maybeSingle();
  const orgId = (org.data as { id: string } | null)?.id;
  if (!orgId) return { status: "no_org", links: [] };

  const houses = await db.from("house_churches").select("id, number").eq("org_id", orgId).order("number");
  const links: LinkRow[] = [];
  const failed: number[] = [];
  for (const house of (houses.data ?? []) as { id: string; number: number }[]) {
    // rotate=false: an existing link is returned as it is.
    const made = await houseFeedbackLink(db, house.id, opts.createdBy ?? null, false);
    if (made.ok) links.push({ number: house.number, houseId: house.id, path: made.path });
    else failed.push(house.number);
  }
  return { status: "done", links, failed };
}
