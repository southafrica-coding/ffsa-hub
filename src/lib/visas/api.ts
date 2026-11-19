// Shared bits for the visa route handlers. The database functions (363)
// decide who may do what; these only turn their errors into HTTP answers
// and stop writes on preview deployments, which share the live database.

import { NextResponse } from "next/server";
import { previewWriteRefusal } from "@/lib/preview-writes";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Calendar date "YYYY-MM-DD" that really exists. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** 403 on a preview deployment; null when writes are allowed. */
export function refusePreviewWrite(): NextResponse | null {
  const r = previewWriteRefusal();
  return r ? NextResponse.json(r.body, { status: r.status }) : null;
}

interface DbError {
  code?: string;
  message?: string;
}

/**
 * The workflow functions raise 42501 (not allowed), P0002 (not found) or
 * P0001 (a rule, with a message written for people). Anything else is a
 * server error whose text we don't pass on.
 */
export function rpcErrorResponse(error: DbError): NextResponse {
  switch (error.code) {
    case "42501":
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    case "P0002":
      return NextResponse.json({ error: error.message ?? "Not found" }, { status: 404 });
    case "P0001":
      return NextResponse.json({ error: error.message ?? "Not allowed right now" }, { status: 409 });
    default:
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/** Optional note: trimmed, capped, empty → null. */
export function cleanNote(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t ? t : null;
}

export const UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};
/**
 * What the file really is, from its first bytes; null if it isn't one of
 * UPLOAD_TYPES. The browser's file.type is only the name's extension, so
 * it isn't trusted.
 */
export function sniffUploadType(head: Uint8Array): string | null {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  const ascii = (offset: number, text: string) => at(offset, [...text].map((c) => c.charCodeAt(0)));
  if (ascii(0, "%PDF-")) return "application/pdf";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftyp") && ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].some((b) => ascii(8, b))) {
    return "image/heic";
  }
  return null;
}

/**
 * A document's file path, only if it is the row's own:
 * '<case_id>/<id>.<ext>' (the CHECK in 360 says the same). Anything else
 * is never signed.
 */
export function ownStoragePath(doc: { id: string; case_id: string; storage_path: string | null }): string | null {
  const p = doc.storage_path;
  if (!p || !isUuid(doc.id) || !isUuid(doc.case_id)) return null;
  const prefix = `${doc.case_id}/${doc.id}.`;
  if (!p.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  return /^[a-z0-9]{2,5}$/.test(p.slice(prefix.length)) ? p : null;
}

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const VISA_BUCKET = "visa-documents";
/** Signed download links last this long (seconds). */
export const SIGNED_URL_TTL = 300;
