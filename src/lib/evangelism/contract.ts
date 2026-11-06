// Evangelism testimony contract.
//
// The admin page at src/app/(admin)/evangelism/page.tsx is still a hidden
// placeholder (HIDDEN_FROM_NAV). There is no testimonies table yet — Hub Data
// owns that schema. These rules are what the API enforces now, so the upload
// form and the TV dashboard can be built against a stable shape.
//
// Storage (proposed, not created here): private bucket `evangelism-media`.
// Objects are signed per upload and never written through the anonymous
// /api/upload/sign route (that one is only for school-application photos).

export const EVANGELISM_MEDIA_BUCKET = "evangelism-media";

/** How often a TV should call GET /api/evangelism/feed. */
export const EVANGELISM_FEED_POLL_SECONDS = 15;

/** Signed read URLs handed to the dashboard. Refreshed on each poll. */
export const EVANGELISM_MEDIA_READ_TTL_SECONDS = 10 * 60;

export function mediaExpiresAt(now = Date.now()): string {
  return new Date(now + EVANGELISM_MEDIA_READ_TTL_SECONDS * 1000).toISOString();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comma-separated or array of testimony ids, capped. */
export function parseTestimonyIds(value: unknown, max = 40): { ok: true; ids: string[] } | { ok: false; message: string } {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : value == null
        ? []
        : null;
  if (!raw) return { ok: false, message: "Story ids must be a list." };
  const ids = [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))];
  if (ids.length > max) return { ok: false, message: `Send at most ${max} story ids.` };
  if (ids.some((id) => !UUID_RE.test(id))) return { ok: false, message: "Story ids must be uuids." };
  return { ok: true, ids };
}

export const TESTIMONY_OUTCOMES = [
  "conversation",
  "prayer",
  "decision",
  "follow_up",
  "other",
] as const;

export type TestimonyOutcome = (typeof TESTIMONY_OUTCOMES)[number];

export const TESTIMONY_STATUSES = ["draft", "submitted", "published", "withheld"] as const;
export type TestimonyStatus = (typeof TESTIMONY_STATUSES)[number];

/** Statuses an author with submit (and not publish) may set. */
export const AUTHOR_STATUSES = ["draft", "submitted"] as const;

export const MAX_MEDIA_PER_TESTIMONY = 8;
export const MAX_VIDEOS_PER_TESTIMONY = 4;

export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 250 * 1024 * 1024;

const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const VIDEO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export type MediaKind = "photo" | "video";

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function normalizeContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function mediaKindFor(contentType: string): MediaKind | null {
  const type = normalizeContentType(contentType);
  if (type in PHOTO_EXT) return "photo";
  if (type in VIDEO_EXT) return "video";
  return null;
}

export function extensionFor(contentType: string): string | null {
  const type = normalizeContentType(contentType);
  return PHOTO_EXT[type] ?? VIDEO_EXT[type] ?? null;
}

export function maxBytesFor(kind: MediaKind): number {
  return kind === "photo" ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES;
}

/**
 * Path the sign route will mint. The uuid is fresh, so a signed URL can only
 * create a new object under the caller's own prefix.
 */
export function buildMediaPath(userId: string, contentType: string, uuid: string): string | null {
  const ext = extensionFor(contentType);
  if (!ext || !isUuid(userId) || !isUuid(uuid)) return null;
  return `testimonies/${userId}/${uuid}.${ext}`;
}

export function isOwnedMediaPath(userId: string, path: string, contentType: string): boolean {
  const ext = extensionFor(contentType);
  if (!ext || !isUuid(userId)) return false;
  const re = new RegExp(`^testimonies/${userId}/${UUID}\\.${ext}$`, "i");
  return re.test(path);
}

function isUuid(value: string): boolean {
  return new RegExp(`^${UUID}$`, "i").test(value);
}

export type TestimonyWrite = {
  title: string;
  body: string;
  occurred_on: string;
  location_label: string;
  people_reached: number;
  decisions: number;
  outcome: TestimonyOutcome;
  consent_to_share: boolean;
  status?: TestimonyStatus;
  withheld_reason?: string | null;
  media?: Array<{ path: string; kind: MediaKind; content_type: string }>;
};

export type FieldError = { field: string; message: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in South Africa, as YYYY-MM-DD. Evangelism dates are base-local. */
export function johannesburgDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Validate a create/update body. `mode` is "create" (every story field
 * required) or "patch" (only the keys present are checked; pass `present`
 * as the set of keys the client sent).
 */
export function validateTestimonyWrite(
  input: Partial<TestimonyWrite>,
  options: { mode: "create" | "patch"; today?: string; canPublish: boolean }
): { ok: true; value: TestimonyWrite } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const today = options.today ?? johannesburgDate();
  const required = options.mode === "create";

  const title = readString(input.title, "title", { min: 3, max: 140, required }, errors);
  const body = readString(input.body, "body", { min: 40, max: 20_000, required }, errors);
  const location = readString(
    input.location_label,
    "location_label",
    { min: 2, max: 80, required },
    errors
  );

  let occurred = input.occurred_on;
  if (occurred === undefined) {
    if (required) errors.push({ field: "occurred_on", message: "Say which day this happened." });
  } else if (typeof occurred !== "string" || !DATE.test(occurred) || occurred > today) {
    errors.push({
      field: "occurred_on",
      message: "Use a real day (YYYY-MM-DD) that is not in the future.",
    });
    occurred = undefined;
  }

  const people = readCount(input.people_reached, "people_reached", required, errors);
  const decisions = readCount(input.decisions, "decisions", required, errors);
  if (people !== undefined && decisions !== undefined && decisions > people) {
    errors.push({
      field: "decisions",
      message: "Decisions cannot be more than the people reached.",
    });
  }

  let outcome = input.outcome;
  if (outcome === undefined) {
    if (required) errors.push({ field: "outcome", message: "Pick what happened." });
  } else if (!TESTIMONY_OUTCOMES.includes(outcome)) {
    errors.push({ field: "outcome", message: "That outcome is not one we record." });
    outcome = undefined;
  }

  let consent = input.consent_to_share;
  if (consent === undefined) {
    if (required) errors.push({ field: "consent_to_share", message: "Say whether this may be shared." });
  } else if (typeof consent !== "boolean") {
    errors.push({ field: "consent_to_share", message: "consent_to_share must be true or false." });
    consent = undefined;
  }

  let status = input.status;
  if (status !== undefined && !TESTIMONY_STATUSES.includes(status)) {
    errors.push({ field: "status", message: "That status is not valid." });
    status = undefined;
  }
  if (status && (status === "published" || status === "withheld") && !options.canPublish) {
    errors.push({ field: "status", message: "Only a publisher can publish or withhold a story." });
  }
  if (status === "submitted" || status === "published") {
    if (consent === false) {
      errors.push({
        field: "consent_to_share",
        message: "A story cannot be submitted or published without consent to share it.",
      });
    }
  }

  let withheld: string | null | undefined = input.withheld_reason;
  if (withheld !== undefined && withheld !== null) {
    if (typeof withheld !== "string") {
      errors.push({ field: "withheld_reason", message: "The reason must be text." });
      withheld = undefined;
    } else {
      withheld = withheld.trim();
      if (withheld.length > 500) {
        errors.push({ field: "withheld_reason", message: "Keep the reason under 500 characters." });
      }
    }
  }

  const media = validateMedia(input.media, errors);

  if (errors.length > 0 || (required && (title === undefined || body === undefined || location === undefined || occurred === undefined || people === undefined || decisions === undefined || outcome === undefined || consent === undefined))) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title: title ?? "",
      body: body ?? "",
      occurred_on: occurred ?? "",
      location_label: location ?? "",
      people_reached: people ?? 0,
      decisions: decisions ?? 0,
      outcome: outcome ?? "other",
      consent_to_share: consent ?? false,
      ...(status ? { status } : {}),
      ...(withheld !== undefined ? { withheld_reason: withheld } : {}),
      ...(media ? { media } : {}),
    },
  };
}

function validateMedia(
  media: TestimonyWrite["media"] | undefined,
  errors: FieldError[]
): TestimonyWrite["media"] | undefined {
  if (media === undefined) return undefined;
  if (!Array.isArray(media)) {
    errors.push({ field: "media", message: "media must be a list." });
    return undefined;
  }
  if (media.length > MAX_MEDIA_PER_TESTIMONY) {
    errors.push({
      field: "media",
      message: `Attach at most ${MAX_MEDIA_PER_TESTIMONY} files.`,
    });
  }
  let videos = 0;
  const cleaned: NonNullable<TestimonyWrite["media"]> = [];
  for (const item of media) {
    const kind = mediaKindFor(item?.content_type ?? "");
    if (!item || !kind || item.kind !== kind || typeof item.path !== "string") {
      errors.push({
        field: "media",
        message: "Each file needs a photo or video type that matches its kind.",
      });
      continue;
    }
    if (kind === "video") videos += 1;
    cleaned.push({
      path: item.path,
      kind,
      content_type: normalizeContentType(item.content_type),
    });
  }
  if (videos > MAX_VIDEOS_PER_TESTIMONY) {
    errors.push({
      field: "media",
      message: `Attach at most ${MAX_VIDEOS_PER_TESTIMONY} videos.`,
    });
  }
  return cleaned;
}

function readString(
  value: unknown,
  field: string,
  rules: { min: number; max: number; required: boolean },
  errors: FieldError[]
): string | undefined {
  if (value === undefined || value === null) {
    if (rules.required) errors.push({ field, message: `${field} is required.` });
    return undefined;
  }
  if (typeof value !== "string") {
    errors.push({ field, message: `${field} must be text.` });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length < rules.min || trimmed.length > rules.max) {
    errors.push({
      field,
      message: `${field} must be ${rules.min}–${rules.max} characters.`,
    });
    return undefined;
  }
  return trimmed;
}

function readCount(
  value: unknown,
  field: string,
  required: boolean,
  errors: FieldError[]
): number | undefined {
  if (value === undefined || value === null) {
    if (required) errors.push({ field, message: `${field} is required.` });
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100_000) {
    errors.push({ field, message: `${field} must be a whole number from 0 to 100000.` });
    return undefined;
  }
  return value;
}

export type SignMediaInput = {
  kind?: unknown;
  content_type?: unknown;
  size?: unknown;
};

export function validateSignMedia(
  input: SignMediaInput
): { ok: true; kind: MediaKind; contentType: string; size: number } | { ok: false; message: string } {
  const contentType = typeof input.content_type === "string" ? normalizeContentType(input.content_type) : "";
  const kind = mediaKindFor(contentType);
  if (!kind || (input.kind !== "photo" && input.kind !== "video") || input.kind !== kind) {
    return {
      ok: false,
      message: "Upload a photo (JPG, PNG, WEBP, HEIC) or a video (MP4, MOV, WEBM).",
    };
  }
  const size = input.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return { ok: false, message: "Say how large the file is." };
  }
  const max = maxBytesFor(kind);
  if (size > max) {
    const mb = Math.round(max / (1024 * 1024));
    return {
      ok: false,
      message: kind === "photo" ? `Photos must be ${mb} MB or smaller.` : `Videos must be ${mb} MB or smaller.`,
    };
  }
  return { ok: true, kind, contentType, size };
}

/**
 * Authors edit their own draft or submitted story. Publishers edit anything.
 * A published or withheld story is locked for the author.
 */
export function canEditTestimony(
  access: { publish: boolean },
  row: { author_user_id: string; status: string },
  userId: string
): boolean {
  if (access.publish) return true;
  return row.author_user_id === userId && (row.status === "draft" || row.status === "submitted");
}

/**
 * Publishing needs the story's own consent flag and a separate publisher
 * confirmation. confirm_consent does not turn a false consent into a true one.
 */
export function publishNeedsConfirmation(input: {
  consentToShare: boolean;
  confirmConsent: unknown;
}): string | null {
  if (!input.consentToShare) {
    return "This story cannot be published without consent to share it.";
  }
  if (input.confirmConsent !== true) {
    return "Confirm consent before publishing this story.";
  }
  return null;
}

export function canDeleteTestimony(
  access: { publish: boolean },
  row: { author_user_id: string; status: string },
  userId: string
): boolean {
  if (access.publish) return true;
  return row.author_user_id === userId && row.status === "draft";
}
