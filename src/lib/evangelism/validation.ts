// Pure input checks for evangelism testimonies. The same limits are CHECKs
// in migration 307 — this layer just turns a bad request into a readable
// 400 before it reaches the database.

/** Today as YYYY-MM-DD in SAST (Vercel renders in UTC). */
function todayInSA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const OUTCOMES = ["conversation", "prayer", "decision", "follow_up", "other"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  conversation: "Conversation",
  prayer: "Prayer",
  decision: "Decision for Jesus",
  follow_up: "Follow-up",
  other: "Other",
};

export const PHOTO_MAX_BYTES = 15 * 1024 * 1024; // 15728640, matches bucket + CHECK
export const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type TestimonyFields = {
  title: string;
  body: string;
  occurred_on: string;
  location_label: string;
  staff_ministry_id: string | null;
  people_reached: number;
  decisions: number;
  outcome: Outcome;
  consent_to_share: boolean;
};

export type PhotoInput = { path: string; content_type: string; size: number };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function wholeNumber(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100000 ? n : null;
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Validate the story fields. `submit` = the author is sending it for
 * review, which needs consent; a draft may be saved without it.
 */
export function parseTestimonyFields(
  raw: unknown,
  opts: { submit: boolean; today?: string }
): Result<TestimonyFields> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = text(b.title);
  const body = text(b.body);
  const occurred_on = text(b.occurred_on);
  const location_label = text(b.location_label);
  const ministry = text(b.staff_ministry_id);
  const people_reached = wholeNumber(b.people_reached ?? 0);
  const decisions = wholeNumber(b.decisions ?? 0);
  const outcome = text(b.outcome) as Outcome;
  const consent_to_share = b.consent_to_share === true;

  if (title.length < 3 || title.length > 140) return { ok: false, error: "Title must be 3–140 characters." };
  if (body.length < 40 || body.length > 20000)
    return { ok: false, error: "Tell the story in at least 40 characters (up to 20,000)." };
  if (!isRealDate(occurred_on)) return { ok: false, error: "Pick the date it happened." };
  if (occurred_on > (opts.today ?? todayInSA())) return { ok: false, error: "The date can't be in the future." };
  if (location_label.length < 2 || location_label.length > 80)
    return { ok: false, error: "Location must be 2–80 characters." };
  if (ministry && !UUID.test(ministry)) return { ok: false, error: "Unknown ministry." };
  if (people_reached === null) return { ok: false, error: "People reached must be a whole number, 0 or more." };
  if (decisions === null) return { ok: false, error: "Decisions must be a whole number, 0 or more." };
  if (decisions > people_reached)
    return { ok: false, error: "Decisions can't be more than people reached." };
  if (!(OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: "Pick an outcome." };
  if (opts.submit && !consent_to_share)
    return {
      ok: false,
      code: "consent_required",
      error: "Tick the consent box before submitting — it confirms this story may be shared inside the Hub.",
    };

  return {
    ok: true,
    value: {
      title,
      body,
      occurred_on,
      location_label,
      staff_ministry_id: ministry || null,
      people_reached,
      decisions,
      outcome,
      consent_to_share,
    },
  };
}

/** image/jpg is a common mislabel for image/jpeg. */
export function normalizePhotoType(contentType: unknown): string {
  const t = typeof contentType === "string" ? contentType.trim().toLowerCase() : "";
  return t === "image/jpg" ? "image/jpeg" : t;
}

/** Checked before minting an upload URL. Returns the file extension. */
export function checkPhoto(contentType: unknown, size: unknown): Result<{ contentType: string; ext: string }> {
  const type = normalizePhotoType(contentType);
  const ext = PHOTO_TYPES[type];
  if (!ext) return { ok: false, error: "Photos must be JPEG, PNG, WebP or HEIC." };
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0)
    return { ok: false, error: "Photo size is missing." };
  if (size > PHOTO_MAX_BYTES) return { ok: false, error: "Photos must be 15 MB or smaller." };
  return { ok: true, value: { contentType: type, ext } };
}

/** The path the sign route mints for this user: testimonies/{user}/{uuid}.{ext} */
export function photoPathFor(userId: string, fileId: string, ext: string): string {
  return `testimonies/${userId}/${fileId}.${ext}`;
}

/** True when `path` is a photo path this user could have been given. */
export function isOwnPhotoPath(path: unknown, userId: string): boolean {
  if (typeof path !== "string" || !UUID.test(userId)) return false;
  const re = new RegExp(`^testimonies/${userId.toLowerCase()}/${UUID_SRC}\\.(jpg|png|webp|heic|heif)$`);
  return re.test(path);
}

/** Validate a `photo` object sent with a create/edit. */
export function parsePhoto(raw: unknown, userId: string): Result<PhotoInput | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const p = raw as Record<string, unknown>;
  const checked = checkPhoto(p.content_type, p.size);
  if (!checked.ok) return checked;
  if (!isOwnPhotoPath(p.path, userId)) return { ok: false, error: "That photo upload isn't yours." };
  const path = p.path as string;
  if (!path.endsWith(`.${checked.value.ext}`)) return { ok: false, error: "Photo type doesn't match the file." };
  return { ok: true, value: { path, content_type: checked.value.contentType, size: p.size as number } };
}

/** Publisher action on PATCH. */
export function parseReview(raw: unknown): Result<{ action: "publish" } | { action: "withhold"; reason: string | null }> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (b.action === "publish") return { ok: true, value: { action: "publish" } };
  if (b.action === "withhold") {
    const reason = text(b.reason);
    if (reason.length > 500) return { ok: false, error: "Keep the reason under 500 characters." };
    return { ok: true, value: { action: "withhold", reason: reason || null } };
  }
  return { ok: false, error: "Unknown review action." };
}
