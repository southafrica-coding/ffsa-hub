import { createAdminClient } from "@/lib/supabase/admin";
import { getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import {
  EVANGELISM_MEDIA_BUCKET,
  isOwnedMediaPath,
  validateTestimonyWrite,
  type TestimonyWrite,
} from "@/lib/evangelism/contract";
import { asError, guardEvangelism, isGuard, json, notEnabled, readBody } from "@/lib/evangelism/http";
import { presentTestimony, type TestimonyRow } from "@/lib/evangelism/present";
import { isEvangelismNotReady } from "@/lib/evangelism/schema-error";
import { loadAuthorNames, signTestimonyMedia } from "@/lib/evangelism/signed-media";
import {
  deleteTestimony,
  getTestimony,
  insertTestimony,
  insertTestimonyMedia,
  listTestimonies,
} from "@/services/evangelism";

// GET  /api/evangelism/testimonies?status=&limit=&mine=1
// POST /api/evangelism/testimonies
//
// Stories for the upload form and the admin list. The TV uses
// GET /api/evangelism/feed instead (published only, cursor, stats).
//
// Required on create: title, body, occurred_on, location_label,
// people_reached, decisions, outcome, consent_to_share.
// Media is optional. Upload the files first via POST /api/evangelism/media/sign
// and pass each returned path here.

const CREATE_LIMIT = 30;
const CREATE_WINDOW_SECONDS = 60 * 60;

function clampLimit(value: string | null): number {
  const n = Number(value ?? "50");
  if (!Number.isInteger(n) || n < 1) return 50;
  return Math.min(n, 100);
}

async function presentMany(rows: TestimonyRow[], publish: boolean) {
  const [urls, names] = await Promise.all([
    signTestimonyMedia(rows),
    loadAuthorNames(rows.map((row) => row.author_user_id)),
  ]);
  return rows.map((row) =>
    presentTestimony(row, {
      urls,
      publish,
      authorName: names.get(row.author_user_id) ?? null,
    })
  );
}

export async function GET(request: Request) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { supabase, user, access } = guard;
  if (!access.view) {
    return json({ error: "forbidden", message: "You cannot view testimonies." }, 403);
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const mine = url.searchParams.get("mine") === "1";
  const limit = clampLimit(url.searchParams.get("limit"));

  if (status && status !== "published" && !access.publish && !(access.submit && mine)) {
    return json({ error: "forbidden", message: "Only a publisher can list unpublished stories." }, 403);
  }

  const visibility = access.publish
    ? { kind: "all" as const, status, authorId: mine ? user.id : undefined }
    : !access.submit
      ? { kind: "published" as const }
      : mine || (status && status !== "published")
        ? { kind: "own" as const, authorId: user.id, status }
        : status === "published"
          ? { kind: "published" as const }
          : { kind: "published_or_own" as const, authorId: user.id };

  const { data, error } = await listTestimonies(supabase, { limit, visibility });
  if (error) return asError(error, "Couldn't load testimonies.");
  return json({ testimonies: await presentMany((data ?? []) as TestimonyRow[], access.publish) });
}

export async function POST(request: Request) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { supabase, user, access } = guard;
  if (!access.submit) {
    return json({ error: "forbidden", message: "You cannot upload a testimony." }, 403);
  }

  const limit = await getRateLimiter().hit(`evangelism-create:${user.id}`, {
    limit: CREATE_LIMIT,
    windowSeconds: CREATE_WINDOW_SECONDS,
  });
  if (!limit.allowed) {
    return json(
      { error: "rate_limited", message: "Too many stories in a short time. Wait and try again." },
      429,
      { "Retry-After": String(retryAfterSeconds(limit)) }
    );
  }

  const parsed = validateTestimonyWrite((await readBody(request)) as Partial<TestimonyWrite>, {
    mode: "create",
    canPublish: access.publish,
  });
  if (!parsed.ok) {
    return json({ error: "bad_request", message: "Check the story fields.", fields: parsed.errors }, 400);
  }
  const story = parsed.value;
  const status = story.status ?? "draft";

  const media = story.media ?? [];
  for (const item of media) {
    if (!isOwnedMediaPath(user.id, item.path, item.content_type)) {
      return json(
        { error: "bad_request", message: "A file path is not one this account uploaded." },
        400
      );
    }
  }

  const sizes = new Map<string, number>();
  if (media.length > 0) {
    const confirmed = await confirmUploads(media.map((item) => item.path));
    if (!confirmed.ok) return confirmed.reason === "not_ready" ? notEnabled() : json(
      { error: "bad_request", message: "One of the files has not finished uploading." },
      400
    );
    for (const [path, size] of confirmed.sizes) sizes.set(path, size);
  }

  const now = new Date().toISOString();
  const { data, error } = await insertTestimony(supabase, {
    author_user_id: user.id,
    title: story.title,
    body: story.body,
    occurred_on: story.occurred_on,
    location_label: story.location_label,
    people_reached: story.people_reached,
    decisions: story.decisions,
    outcome: story.outcome,
    consent_to_share: story.consent_to_share,
    status,
    published_at: status === "published" ? now : null,
    published_by: status === "published" ? user.id : null,
    withheld_reason: status === "withheld" ? story.withheld_reason ?? null : null,
  });
  if (error) return asError(error, "Couldn't save the testimony.");

  const row = data as TestimonyRow;
  if (media.length > 0) {
    const { error: mediaError } = await insertTestimonyMedia(
      supabase,
      media.map((item, index) => ({
        testimony_id: row.id,
        kind: item.kind,
        storage_path: item.path,
        content_type: item.content_type,
        size_bytes: sizes.get(item.path) ?? 0,
        sort_order: index,
        created_by: user.id,
      }))
    );
    if (mediaError) {
      await deleteTestimony(supabase, row.id);
      return asError(mediaError, "Couldn't attach the files.");
    }
  }

  const { data: fresh, error: reloadError } = await getTestimony(supabase, row.id);
  if (reloadError) return asError(reloadError, "Saved the story but couldn't read it back.");
  const saved = (fresh as TestimonyRow | null) ?? row;
  const [presented] = await presentMany([saved], access.publish);
  return json({ testimony: presented }, 201);
}

async function confirmUploads(
  paths: string[]
): Promise<{ ok: true; sizes: Map<string, number> } | { ok: false; reason: "missing" | "not_ready" }> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, reason: "not_ready" };
  }
  const bucket = admin.storage.from(EVANGELISM_MEDIA_BUCKET);
  const sizes = new Map<string, number>();
  for (const path of paths) {
    const slash = path.lastIndexOf("/");
    const folder = path.slice(0, slash);
    const name = path.slice(slash + 1);
    const { data, error } = await bucket.list(folder, { search: name });
    if (error) return { ok: false, reason: isEvangelismNotReady(error) ? "not_ready" : "missing" };
    const found = (data ?? []).find((object: { name: string; metadata?: { size?: number } }) => object.name === name);
    if (!found) return { ok: false, reason: "missing" };
    sizes.set(path, Number(found.metadata?.size ?? 0));
  }
  return { ok: true, sizes };
}
