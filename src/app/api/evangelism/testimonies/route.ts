import { createAdminClient } from "@/lib/supabase/admin";
import { getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import {
  EVANGELISM_MEDIA_BUCKET,
  isOwnedMediaPath,
  publishNeedsConfirmation,
  validateTestimonyWrite,
  type MediaKind,
  type TestimonyWrite,
} from "@/lib/evangelism/contract";
import { assessUpload } from "@/lib/evangelism/media-bytes";
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

  const raw = (await readBody(request)) as Partial<TestimonyWrite> & { confirm_consent?: unknown };
  const parsed = validateTestimonyWrite(raw ?? {}, {
    mode: "create",
    canPublish: access.publish,
  });
  if (!parsed.ok) {
    return json({ error: "bad_request", message: "Check the story fields.", fields: parsed.errors }, 400);
  }
  const story = parsed.value;
  const status = story.status ?? "draft";
  if (status === "published") {
    const consent = publishNeedsConfirmation({
      consentToShare: story.consent_to_share,
      confirmConsent: raw?.confirm_consent,
    });
    if (consent) return json({ error: "bad_request", message: consent }, 400);
  }

  const media = story.media ?? [];
  for (const item of media) {
    if (!isOwnedMediaPath(user.id, item.path, item.content_type)) {
      return json(
        { error: "bad_request", message: "A file path is not one this account uploaded." },
        400
      );
    }
  }

  const checked = new Map<string, { size: number; contentType: string; kind: MediaKind }>();
  if (media.length > 0) {
    const confirmed = await confirmUploads(media);
    if (!confirmed.ok) {
      return confirmed.reason === "not_ready"
        ? notEnabled()
        : json({ error: "bad_request", message: confirmed.message }, 400);
    }
    let videos = 0;
    for (const [path, file] of confirmed.files) {
      checked.set(path, file);
      if (file.kind === "video") videos += 1;
    }
    if (videos > 4) {
      return json({ error: "bad_request", message: "Attach at most 4 videos." }, 400);
    }
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
        content_type: checked.get(item.path)?.contentType ?? item.content_type,
        size_bytes: checked.get(item.path)?.size ?? 0,
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
  media: Array<{ path: string; kind: MediaKind }>
): Promise<
  | { ok: true; files: Map<string, { size: number; contentType: string; kind: MediaKind }> }
  | { ok: false; reason: "rejected" | "not_ready"; message: string }
> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, reason: "not_ready", message: "Uploads are not available yet." };
  }
  const bucket = admin.storage.from(EVANGELISM_MEDIA_BUCKET);
  const files = new Map<string, { size: number; contentType: string; kind: MediaKind }>();
  const accepted: string[] = [];
  const reject = async (message: string) => {
    if (accepted.length > 0) await bucket.remove(accepted);
    return { ok: false as const, reason: "rejected" as const, message };
  };
  for (const item of media) {
    const slash = item.path.lastIndexOf("/");
    const folder = item.path.slice(0, slash);
    const name = item.path.slice(slash + 1);
    const listed = await bucket.list(folder, { search: name });
    if (listed.error) {
      return isEvangelismNotReady(listed.error)
        ? { ok: false, reason: "not_ready", message: "Uploads are not available yet." }
        : reject("One of the files has not finished uploading.");
    }
    const found = (listed.data ?? []).find((object: { name: string; metadata?: { size?: number } }) => object.name === name);
    const size = Number(found?.metadata?.size ?? 0);
    if (!found || !Number.isInteger(size) || size <= 0) {
      return reject("One of the files has not finished uploading.");
    }
    accepted.push(item.path);

    const signed = await bucket.createSignedUrl(item.path, 60);
    if (signed.error || !signed.data?.signedUrl) {
      return isEvangelismNotReady(signed.error)
        ? { ok: false, reason: "not_ready", message: "Uploads are not available yet." }
        : reject("One of the files could not be checked.");
    }
    const head = await fetch(signed.data.signedUrl, { headers: { Range: "bytes=0-31" } });
    if (!head.ok && head.status !== 206) return reject("One of the files could not be checked.");
    const header = new Uint8Array(await head.arrayBuffer());
    const assessed = assessUpload({ declaredKind: item.kind, size, header });
    if (!assessed.ok) return reject(assessed.message);
    files.set(item.path, { size: assessed.size, contentType: assessed.contentType, kind: assessed.kind });
  }
  return { ok: true, files };
}
