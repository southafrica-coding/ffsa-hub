import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { previewWritesDisabled } from "@/lib/preview-writes";
import { clientIp, getRateLimiter, retryAfterSeconds, type RateLimiter } from "@/lib/rate-limit";
import type { RunDeps } from "@/lib/forms/route-runner";
import type { FormField, FormSchema } from "@/lib/forms/schema";
import { PUBLIC_FEEDBACK_HONEYPOT, PUBLIC_HOUSE_QUESTION, type PublicHouse } from "./public-feedback-link";
import { feedbackSunday, saveWeeklyFeedback, type WeeklyHouse } from "./weekly-feedback";

// ============================================================
// Missio weekly feedback — the one public link (server)
// ============================================================
// /f/missio-weekly-feedback: no login, no token. The person picks
// their house church first; the answers then go down the same path
// as the house's own link (saveWeeklyFeedback): form_submissions
// with subject = that house, then the route runner writes the week's
// missio_house_feedback row. The meeting date is the server's.
//
// What a stranger can learn from this page: the Missio house numbers
// and names, each house's next meeting date, and the questions. The
// schema goes through publicRenderSchema first, so where answers go
// (routes: write_column, slack, care_board, follow-ups, contacts) stays
// on the server. The server still saves with the full stored schema.
//
// Abuse: a per-IP write limit, a per-house write limit, a honeypot
// that saves nothing, and the house id checked against the Missio
// org on the server. Previews never save (saveWeeklyFeedback).
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function missioOrgId(db: Db): Promise<string | null> {
  const { data, error } = await db.from("organisations").select("id").eq("slug", "missio").maybeSingle();
  if (error || !data) return null;
  return String((data as { id: string }).id);
}

// ────────────────────────────────────────────────────────────
// What the browser gets
// ────────────────────────────────────────────────────────────

/** The only parts of a question the public page needs to draw it and post its answer. */
const RENDER_KEYS = [
  "id",
  "type",
  "label",
  "key",
  "required",
  "options",
  "helpText",
  "parentFieldId",
  "showWhenValue",
  "min",
  "max",
  "minLabel",
  "maxLabel",
] as const satisfies ReadonlyArray<keyof FormField>;

/**
 * The schema as a stranger may see it: steps, questions and the thank-you
 * text. Built from a whitelist, so routes (and anything added to a field
 * later) never reach the browser. Only for the public page: validation and
 * saveWeeklyFeedback load the full stored schema themselves.
 */
export function publicRenderSchema(schema: FormSchema): FormSchema {
  return {
    version: 1,
    branding: {},
    steps: schema.steps.map((step) => ({
      id: String(step.id),
      title: String(step.title ?? ""),
      fields: step.fields.map((field) => {
        const out: Record<string, unknown> = {};
        for (const k of RENDER_KEYS) if (field[k] !== undefined) out[k] = Array.isArray(field[k]) ? [...(field[k] as string[])] : field[k];
        return out as FormField;
      }),
    })),
    thankYou: { heading: String(schema.thankYou?.heading ?? ""), message: String(schema.thankYou?.message ?? "") },
  };
}

/**
 * Every Missio house church, number order, as { id, number, name,
 * meetingDate } only. meetingDate is the server's date for this week's
 * meeting (feedbackSunday: the house's meeting day, Sunday when unset), so
 * the heading can say the right day once a house is chosen.
 * house_churches has no active / archived column (migration 331), so every
 * house in the Missio org is listed (the 20 on campus Potch).
 */
export async function listPublicHouses(db: Db, now = new Date()): Promise<PublicHouse[]> {
  const orgId = await missioOrgId(db);
  if (!orgId) return [];
  const { data, error } = await db
    .from("house_churches")
    .select("id, number, name, meeting_day")
    .eq("org_id", orgId)
    .order("number");
  if (error || !Array.isArray(data)) return [];
  // Project again: whatever the query returns, only these four leave.
  return (data as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    number: Number(row.number),
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
    meetingDate: feedbackSunday(typeof row.meeting_day === "string" ? row.meeting_day : null, now),
  }));
}

/** The house, if the id is a real Missio house church. Null for anything else. */
export async function loadPublicHouse(db: Db, houseId: unknown): Promise<WeeklyHouse | null> {
  if (typeof houseId !== "string" || !UUID.test(houseId)) return null;
  const orgId = await missioOrgId(db);
  if (!orgId) return null;
  const { data, error } = await db
    .from("house_churches")
    .select("id, org_id, number, name, meeting_day")
    .eq("id", houseId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as WeeklyHouse;
  return row.org_id === orgId ? row : null;
}

// ────────────────────────────────────────────────────────────
// Limits
// ────────────────────────────────────────────────────────────

const LIMITED = "Too many tries. Wait a few minutes, then send again.";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

/**
 * The same limiter as the house links (serveAvailabilityLimit), with
 * tighter buckets because nothing secret stands in front of this form:
 * 30 sends per IP and 30 per house per 10 minutes. A whole church on one
 * Wi-Fi sending 20 houses' feedback still fits.
 */
export async function publicFeedbackLimit(
  request: Request,
  scope: { houseId?: string } = {},
  limiter: RateLimiter = getRateLimiter()
): Promise<NextResponse | null> {
  const key = scope.houseId
    ? `serve:missio:public-feedback:house:${createHash("sha256").update(scope.houseId).digest("hex")}`
    : `serve:missio:public-feedback:ip:${clientIp(request)}`;
  const hit = await limiter.hit(key, { limit: 30, windowSeconds: 600 });
  if (hit.allowed) return null;
  return json({ error: LIMITED, code: "rate_limited" }, 429, { "Retry-After": String(retryAfterSeconds(hit)) });
}

// ────────────────────────────────────────────────────────────
// POST
// ────────────────────────────────────────────────────────────

export type PublicSubmitDeps = RunDeps & { limiter?: RateLimiter };

/**
 * POST /api/f/missio-weekly-feedback/submit  { houseId, answers, website }
 * The generic submit route hands this form here before any of its own
 * contact / label / workflow steps.
 */
export async function handlePublicWeeklyFeedback(request: Request, db: Db, deps: PublicSubmitDeps = {}): Promise<NextResponse> {
  const env = deps.env ?? process.env;
  const limited = await publicFeedbackLimit(request, {}, deps.limiter);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Check the answers and try again.", code: "invalid_input" }, 400);
  }

  // A bot filled the hidden field: say thanks, save nothing.
  const trap = body[PUBLIC_FEEDBACK_HONEYPOT];
  if (trap != null && trap !== "") return json({ ok: true });

  if (previewWritesDisabled(env)) {
    return json({ error: "This preview can’t send feedback. Use the live Hub.", code: "preview_writes_disabled" }, 403);
  }

  const house = await loadPublicHouse(db, body.houseId);
  if (!house) {
    return json(
      {
        error: "Choose your house church from the list.",
        code: "invalid_house",
        fieldErrors: { house_church: `${PUBLIC_HOUSE_QUESTION} Choose one from the list.` },
      },
      400
    );
  }

  const houseLimited = await publicFeedbackLimit(request, { houseId: house.id }, deps.limiter);
  if (houseLimited) return houseLimited;

  const result = await saveWeeklyFeedback(
    db,
    {
      house,
      linkId: null,
      answers: body.answers,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    },
    { env, now: deps.now, slack: deps.slack }
  );
  if (!result.ok) return json({ error: result.error, code: result.code, fieldErrors: result.fieldErrors }, result.status);
  return json({ ok: true, meetingDate: result.meetingDate });
}
