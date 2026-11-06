// Client-side mirror of the testimony contract in PR #499
// (src/lib/evangelism/contract.ts on that branch). The API is not on main
// yet, so this file stays inside the evangelism UI and does not import the
// server modules that PR adds.

export const FEED_PATH = "/api/evangelism/feed";
export const TESTIMONIES_PATH = "/api/evangelism/testimonies";
export const MEDIA_SIGN_PATH = "/api/evangelism/media/sign";

/** How often the TV calls the feed. The response also sends poll_after_seconds. */
export const FEED_POLL_SECONDS = 15;

/**
 * Signed read URLs last 10 minutes. Refresh the whole window a little before
 * that so a photo already on screen does not die between cursor polls.
 */
export const FEED_URL_REFRESH_MS = 8 * 60 * 1000;

export const OUTCOMES = [
  { value: "conversation", label: "Conversation" },
  { value: "prayer", label: "Prayer" },
  { value: "decision", label: "Decision" },
  { value: "follow_up", label: "Follow-up" },
  { value: "other", label: "Other" },
] as const;

export type OutcomeValue = (typeof OUTCOMES)[number]["value"];

export const STATUSES = ["draft", "submitted", "published", "withheld"] as const;
export type StoryStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Waiting",
  published: "Published",
  withheld: "Withheld",
};

export const LIMITS = {
  titleMin: 3,
  titleMax: 140,
  bodyMin: 40,
  bodyMax: 20_000,
  locationMin: 2,
  locationMax: 80,
  withheldMax: 500,
  countMax: 100_000,
  maxMedia: 8,
  maxVideos: 4,
  photoBytes: 15 * 1024 * 1024,
  videoBytes: 250 * 1024 * 1024,
  listCap: 100,
};

export type FieldError = { field: string; message: string };

export type StoryInput = {
  title: string;
  body: string;
  occurred_on: string;
  location_label: string;
  people_reached: string;
  decisions: string;
  outcome: OutcomeValue | "";
  consent_to_share: boolean;
};

export type StoryWrite = {
  title: string;
  body: string;
  occurred_on: string;
  location_label: string;
  people_reached: number;
  decisions: number;
  outcome: OutcomeValue;
  consent_to_share: boolean;
  status?: StoryStatus;
  withheld_reason?: string | null;
  media?: Array<{ path: string; kind: "photo" | "video"; content_type: string }>;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

const BY_EXTENSION: Record<string, { kind: "photo" | "video"; contentType: string }> = {
  jpg: { kind: "photo", contentType: "image/jpeg" },
  jpeg: { kind: "photo", contentType: "image/jpeg" },
  png: { kind: "photo", contentType: "image/png" },
  webp: { kind: "photo", contentType: "image/webp" },
  heic: { kind: "photo", contentType: "image/heic" },
  heif: { kind: "photo", contentType: "image/heif" },
  mp4: { kind: "video", contentType: "video/mp4" },
  mov: { kind: "video", contentType: "video/quicktime" },
  webm: { kind: "video", contentType: "video/webm" },
};

/** Today in South Africa, as YYYY-MM-DD. Evangelism dates are base-local. */
export function johannesburgDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function johannesburgClock(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

export function emptyStory(today = johannesburgDate()): StoryInput {
  return {
    title: "",
    body: "",
    occurred_on: today,
    location_label: "",
    people_reached: "",
    decisions: "",
    outcome: "",
    consent_to_share: false,
  };
}

export function outcomeLabel(value: string): string {
  return OUTCOMES.find((item) => item.value === value)?.label ?? value;
}

export function statusLabel(value: string): string {
  return STATUS_LABEL[value] ?? value;
}

export function formatStoryDate(isoDate: string): string {
  if (!DATE.test(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatJohannesburg(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function excerpt(body: string, max = 420): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** The one yellow band. Null when there is nothing waiting — never invent a count. */
export function waitingCopy(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (count >= LIMITS.listCap) return `At least ${LIMITS.listCap} stories are waiting to be published`;
  if (count === 1) return "1 story is waiting to be published";
  return `${count} stories are waiting to be published`;
}

export function fieldMessage(errors: FieldError[], field: string): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

function pushLength(
  errors: FieldError[],
  field: string,
  value: string,
  min: number,
  max: number
) {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    errors.push({ field, message: `${field} must be ${min}–${max} characters.` });
  }
}

function readCount(errors: FieldError[], field: string, raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    errors.push({ field, message: `${field} is required.` });
    return undefined;
  }
  if (!/^\d+$/.test(trimmed)) {
    errors.push({ field, message: `${field} must be a whole number from 0 to ${LIMITS.countMax}.` });
    return undefined;
  }
  const value = Number(trimmed);
  if (value > LIMITS.countMax) {
    errors.push({ field, message: `${field} must be a whole number from 0 to ${LIMITS.countMax}.` });
    return undefined;
  }
  return value;
}

/**
 * Same rules the create route enforces. `submit` also requires consent.
 * A draft still needs the story fields — the API does not store an empty row.
 */
export function validateStory(
  input: StoryInput,
  options: { intent: "draft" | "submit"; today?: string }
): { ok: true; value: StoryWrite } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const today = options.today ?? johannesburgDate();

  pushLength(errors, "title", input.title, LIMITS.titleMin, LIMITS.titleMax);
  pushLength(errors, "body", input.body, LIMITS.bodyMin, LIMITS.bodyMax);
  pushLength(errors, "location_label", input.location_label, LIMITS.locationMin, LIMITS.locationMax);

  if (!DATE.test(input.occurred_on) || input.occurred_on > today) {
    errors.push({
      field: "occurred_on",
      message: "Use a real day (YYYY-MM-DD) that is not in the future.",
    });
  }

  const people = readCount(errors, "people_reached", input.people_reached);
  const decisions = readCount(errors, "decisions", input.decisions);
  if (people !== undefined && decisions !== undefined && decisions > people) {
    errors.push({
      field: "decisions",
      message: "Decisions cannot be more than the people reached.",
    });
  }

  const outcome = OUTCOMES.find((item) => item.value === input.outcome)?.value;
  if (!outcome) errors.push({ field: "outcome", message: "Pick what happened." });

  if (options.intent === "submit" && !input.consent_to_share) {
    errors.push({
      field: "consent_to_share",
      message: "A story cannot be submitted or published without consent to share it.",
    });
  }

  if (
    errors.length > 0 ||
    people === undefined ||
    decisions === undefined ||
    !outcome
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title: input.title.trim(),
      body: input.body.trim(),
      occurred_on: input.occurred_on,
      location_label: input.location_label.trim(),
      people_reached: people,
      decisions,
      outcome,
      consent_to_share: input.consent_to_share,
      status: options.intent === "submit" ? "submitted" : "draft",
    },
  };
}

export function validateWithheldReason(reason: string): FieldError | null {
  const trimmed = reason.trim();
  if (!trimmed) return { field: "withheld_reason", message: "Say why this stays off the TV." };
  if (trimmed.length > LIMITS.withheldMax) {
    return { field: "withheld_reason", message: "Keep the reason under 500 characters." };
  }
  return null;
}

export function classifyFile(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true; kind: "photo" | "video"; contentType: string } | { ok: false; message: string } {
  const type = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  let kind: "photo" | "video" | null = null;
  let contentType = type;
  if (PHOTO_TYPES.has(type)) kind = "photo";
  else if (VIDEO_TYPES.has(type)) kind = "video";
  else {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mapped = BY_EXTENSION[ext];
    if (mapped) {
      kind = mapped.kind;
      contentType = mapped.contentType;
    }
  }
  if (!kind) {
    return {
      ok: false,
      message: "Upload a photo (JPG, PNG, WEBP, HEIC) or a video (MP4, MOV, WEBM).",
    };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: "That file is empty." };
  }
  const max = kind === "photo" ? LIMITS.photoBytes : LIMITS.videoBytes;
  if (file.size > max) {
    const mb = Math.round(max / (1024 * 1024));
    return {
      ok: false,
      message: kind === "photo" ? `Photos must be ${mb} MB or smaller.` : `Videos must be ${mb} MB or smaller.`,
    };
  }
  return { ok: true, kind, contentType };
}

export function mediaLimitMessage(files: Array<{ kind: "photo" | "video" }>): string | null {
  if (files.length > LIMITS.maxMedia) return `Attach at most ${LIMITS.maxMedia} files.`;
  const videos = files.filter((file) => file.kind === "video").length;
  if (videos > LIMITS.maxVideos) return `Attach at most ${LIMITS.maxVideos} videos.`;
  return null;
}

export function feedUrl(since: string | null | undefined): string {
  if (!since || Number.isNaN(Date.parse(since))) return FEED_PATH;
  return `${FEED_PATH}?since=${encodeURIComponent(since)}`;
}

export function testimoniesUrl(query: { status?: string; mine?: boolean; limit?: number }): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.mine) params.set("mine", "1");
  if (query.limit) params.set("limit", String(query.limit));
  const search = params.toString();
  return search ? `${TESTIMONIES_PATH}?${search}` : TESTIMONIES_PATH;
}

export type Testimony = {
  id: string;
  title: string;
  body: string;
  occurred_on: string;
  location_label: string;
  people_reached: number;
  decisions: number;
  outcome: string;
  consent_to_share: boolean;
  status: string;
  published_at: string | null;
  author_user_id: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  withheld_reason?: string | null;
  published_by?: string | null;
  media: TestimonyMedia[];
};

export type TestimonyMedia = {
  id: string;
  kind: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
  url: string | null;
};

/** Publishers receive withheld_reason; viewers and the TV do not. */
export function viewerCanPublish(row: Testimony): boolean {
  return Object.prototype.hasOwnProperty.call(row, "withheld_reason");
}

export function authorName(row: { author_name: string | null }): string {
  const name = row.author_name?.trim();
  return name || "A team member";
}

export function mergeTestimonies(
  current: Testimony[],
  incoming: Testimony[],
  mode: "append" | "replace"
): Testimony[] {
  if (mode === "replace") return incoming;
  const next = current.slice();
  const index = new Map(next.map((row, position) => [row.id, position]));
  for (const row of incoming) {
    const at = index.get(row.id);
    if (at === undefined) {
      index.set(row.id, next.length);
      next.push(row);
    } else {
      next[at] = row;
    }
  }
  return next;
}

export function storyFromTestimony(row: Testimony): StoryInput {
  const outcome = OUTCOMES.find((item) => item.value === row.outcome)?.value ?? "";
  return {
    title: row.title,
    body: row.body,
    occurred_on: row.occurred_on,
    location_label: row.location_label,
    people_reached: String(row.people_reached ?? ""),
    decisions: String(row.decisions ?? ""),
    outcome,
    consent_to_share: row.consent_to_share,
  };
}
