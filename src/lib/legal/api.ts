// Shared plumbing for the /api/legal routes. The wall itself is RLS
// (migration 371): these helpers only turn its answers into clean HTTP
// statuses and keep request bodies to known fields.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { hasLegalAccess } from "@/services/legal-documents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Gate =
  | { error: NextResponse; supabase?: never; userId?: never }
  | { error: null; supabase: Client; userId: string };

/** Signed in and on the access list (any live row), or an error response. */
export async function legalGate(): Promise<Gate> {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data, error } = await hasLegalAccess(supabase);
  if (error || data !== true) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { error: null, supabase, userId: user.id };
}

/** Maps a Supabase error: RLS refusals are 403, bad input 400, the rest 500. */
export function dbError(error: { code?: string; message: string }) {
  if (error.code === "42501") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (error.code === "PGRST116") return NextResponse.json({ error: "Not found" }, { status: 404 });
  // check, not-null, foreign key, unique
  if (["23514", "23502", "23503", "23505", "22007", "22008", "22P02"].includes(error.code ?? "")) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// FIELD PARSING — each returns the clean value, or throws BadField
// ────────────────────────────────────────────────────────────

export class BadField extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export const field = {
  text(v: unknown, name: string, max: number, opts: { required?: boolean } = {}): string | null {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) {
      if (opts.required) throw new BadField(`${name} is required`);
      return null;
    }
    if (typeof v !== "string") throw new BadField(`${name} must be text`);
    const t = v.trim();
    if (t.length > max) throw new BadField(`${name} is longer than ${max} characters`);
    return t;
  },
  date(v: unknown, name: string): string | null {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v !== "string" || !YMD.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      throw new BadField(`${name} must be a date (YYYY-MM-DD)`);
    }
    return v;
  },
  uuid(v: unknown, name: string, opts: { required?: boolean } = {}): string | null {
    if (v === null || v === undefined || v === "") {
      if (opts.required) throw new BadField(`${name} is required`);
      return null;
    }
    if (!isUuid(v)) throw new BadField(`${name} is not a valid id`);
    return v;
  },
  int(v: unknown, name: string, min: number, max: number): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new BadField(`${name} must be a whole number from ${min} to ${max}`);
    return n;
  },
  oneOf<T extends string>(v: unknown, name: string, options: readonly T[]): T {
    if (typeof v !== "string" || !(options as readonly string[]).includes(v)) {
      throw new BadField(`${name} must be one of: ${options.join(", ")}`);
    }
    return v as T;
  },
};

/**
 * Runs `spec` for each key present in `body` (absent keys are skipped, so
 * the same spec serves create and update). Returns the clean object.
 */
export function pick(
  body: Record<string, unknown>,
  spec: Record<string, (v: unknown) => unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, parse] of Object.entries(spec)) {
    if (key in body) out[key] = parse(body[key]);
  }
  return out;
}

/** Wraps a handler so a BadField becomes a 400. */
export function withBadField<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof BadField) return bad(e.message);
      throw e;
    }
  };
}

// ────────────────────────────────────────────────────────────
// SPECS — the fields each table accepts from the screens
// ────────────────────────────────────────────────────────────

export const FOLDER_KINDS = ["organisation", "personal", "project"] as const;
export const DOCUMENT_STATUSES = ["held", "applying", "not_held", "superseded", "cancelled"] as const;
export const APPLICATION_STATUSES = [
  "planned", "gathering", "submitted", "waiting", "approved", "refused", "withdrawn",
] as const;

export const FOLDER_SPEC = {
  name: (v: unknown) => field.text(v, "Name", 120, { required: true }),
  kind: (v: unknown) => field.oneOf(v, "Kind", FOLDER_KINDS),
  description: (v: unknown) => field.text(v, "Description", 500),
};

export const DOCUMENT_SPEC = {
  folder_id: (v: unknown) => field.uuid(v, "Folder", { required: true }),
  type_id: (v: unknown) => field.uuid(v, "Type"),
  title: (v: unknown) => field.text(v, "Title", 200, { required: true }),
  holder: (v: unknown) => field.text(v, "Holder", 200),
  issuer: (v: unknown) => field.text(v, "Issuer", 200),
  reference_no: (v: unknown) => field.text(v, "Reference number", 120),
  issued_on: (v: unknown) => field.date(v, "Issued"),
  expires_on: (v: unknown) => field.date(v, "Expires"),
  renew_lead_days: (v: unknown) => field.int(v, "Renewal lead time", 0, 730),
  status: (v: unknown) => field.oneOf(v, "Status", DOCUMENT_STATUSES),
  superseded_by: (v: unknown) => field.uuid(v, "Replaced by"),
  notes: (v: unknown) => field.text(v, "Notes", 5000),
};

export const APPLICATION_SPEC = {
  folder_id: (v: unknown) => field.uuid(v, "Folder", { required: true }),
  document_id: (v: unknown) => field.uuid(v, "Document"),
  title: (v: unknown) => field.text(v, "Title", 200, { required: true }),
  status: (v: unknown) => field.oneOf(v, "Status", APPLICATION_STATUSES),
  lodge_by: (v: unknown) => field.date(v, "Lodge by"),
  submitted_on: (v: unknown) => field.date(v, "Submitted"),
  expected_on: (v: unknown) => field.date(v, "Expected"),
  closed_on: (v: unknown) => field.date(v, "Closed"),
  reference_no: (v: unknown) => field.text(v, "Reference number", 120),
  responsible_id: (v: unknown) => field.uuid(v, "Responsible"),
  notes: (v: unknown) => field.text(v, "Notes", 5000),
};

export const STEP_SPEC = {
  label: (v: unknown) => field.text(v, "Step", 200, { required: true }),
  due_on: (v: unknown) => field.date(v, "Due"),
  position: (v: unknown) => field.int(v, "Position", 0, 1000),
  notes: (v: unknown) => field.text(v, "Notes", 2000),
};

// ────────────────────────────────────────────────────────────
// FILES
// ────────────────────────────────────────────────────────────

export const FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const SIGNED_URL_SECONDS = 300;
