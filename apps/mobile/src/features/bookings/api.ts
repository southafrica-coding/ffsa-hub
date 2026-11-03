// The website's bookings API, as the phone uses it. Every write goes through
// these routes (never straight to the tables) so the server-side steps run:
// the clash and licence checks, the vehicle managers' emails, the
// requester's Slack DM + email, the prayer-room booking alerts. All of these
// routes build their Supabase client with the web's createClient(), which
// accepts the app's bearer token, and check permissions themselves.

import { z } from "zod";

import { ApiError } from "@/lib/api";

import type { BookingsFetch } from "./http";
import { ServerRefusal, UPLOAD_TIMEOUT_MS } from "./http";
import { spacePayload, vehicleDryRunPayload, vehiclePayload, type InspectionKind, type PhotoKind, type SpaceForm, type VehicleForm } from "./logic";
import { strings } from "./strings";
import { conflictSchema, personSchema, type Conflict } from "./types";

const ok = z.object({ ok: z.literal(true) }).passthrough();

// ── Spaces: POST /api/bookings, PATCH /api/bookings/[id], POST …/decision ──

const spaceCheckSchema = z.object({
  ok: z.literal(true),
  conflicts: z.array(conflictSchema).nullish().transform((v) => v ?? []),
  autoConfirm: z.boolean().nullish().transform((v) => v ?? false),
  blocked: z.boolean().nullish().transform((v) => v ?? false),
});
export type SpaceCheck = z.infer<typeof spaceCheckSchema>;

/** The server's own clash check (dryRun: nothing is saved). */
export function checkSpace(fetch: BookingsFetch, f: SpaceForm, init?: { signal?: AbortSignal }) {
  return fetch("/api/bookings", { method: "POST", body: spacePayload(f, true), schema: spaceCheckSchema, ...init });
}

const spaceCreatedSchema = z.object({
  ok: z.literal(true),
  bookingId: z.string().nullish().transform((v) => v ?? null),
  autoConfirm: z.boolean().nullish().transform((v) => v ?? false),
  conflicts: z.array(conflictSchema).nullish().transform((v) => v ?? []),
});

export type SpaceSubmitResult =
  | { kind: "created"; bookingId: string | null; autoConfirm: boolean }
  | { kind: "blocked"; message: string; conflicts: Conflict[] };

/** Create the request. A 409 is the server refusing a double-booking on an auto-confirm space. */
export async function submitSpace(fetch: BookingsFetch, f: SpaceForm): Promise<SpaceSubmitResult> {
  try {
    const res = await fetch("/api/bookings", { method: "POST", body: spacePayload(f, false), schema: spaceCreatedSchema });
    return { kind: "created", bookingId: res.bookingId, autoConfirm: res.autoConfirm };
  } catch (err) {
    if (err instanceof ServerRefusal && err.status === 409 && err.body.blocked === true) {
      const parsed = z.array(conflictSchema).safeParse(err.body.conflicts);
      return { kind: "blocked", message: err.message, conflicts: parsed.success ? parsed.data : [] };
    }
    throw err;
  }
}

export function cancelSpace(fetch: BookingsFetch, id: string, wholeSeries: boolean) {
  return fetch(`/api/bookings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { cancel: true, applyToSeries: wholeSeries },
    schema: ok,
  });
}

export function decideSpace(fetch: BookingsFetch, id: string, decision: "approved" | "denied", note: string, applyToSeries: boolean) {
  return fetch(`/api/bookings/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: { decision, note: note.trim() || null, applyToSeries },
    schema: ok,
  });
}

// ── Vehicles ────────────────────────────────────────────────────────────────

const vehicleCheckSchema = z.object({
  ok: z.literal(true),
  unavailableVehicleIds: z.array(z.string()).nullish().transform((v) => v ?? []),
  clashingVehicleIds: z.array(z.string()).nullish().transform((v) => v ?? []),
  blocked: z.boolean().nullish().transform((v) => v ?? false),
});
export type VehicleCheck = z.infer<typeof vehicleCheckSchema>;

/** Which vehicles are taken over those dates (the server's overlap check). */
export function checkVehicles(fetch: BookingsFetch, checkout: string, returnDate: string, vehicleIds: string[] = [], init?: { signal?: AbortSignal }) {
  return fetch("/api/vehicles/bookings", {
    method: "POST",
    body: vehicleDryRunPayload(checkout, returnDate, vehicleIds),
    schema: vehicleCheckSchema,
    ...init,
  });
}

const vehicleCreatedSchema = z.object({ ok: z.literal(true), bookingId: z.string() }).passthrough();

export function submitVehicle(fetch: BookingsFetch, f: VehicleForm) {
  return fetch("/api/vehicles/bookings", { method: "POST", body: vehiclePayload(f), schema: vehicleCreatedSchema });
}

export function cancelVehicle(fetch: BookingsFetch, id: string) {
  return fetch(`/api/vehicles/bookings/${encodeURIComponent(id)}`, { method: "PATCH", body: { status: "cancelled" }, schema: ok });
}

export function decideVehicle(fetch: BookingsFetch, id: string, decision: "approved" | "denied", note: string) {
  return fetch(`/api/vehicles/bookings/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: { decision, note: note.trim() || null },
    schema: ok,
  });
}

/** The renter/driver roster (names + licence STATUS only; the server never sends numbers or paths). */
export async function listPeople(fetch: BookingsFetch, init?: { signal?: AbortSignal }) {
  const res = await fetch("/api/vehicles/people", {
    ...init,
    schema: z.object({ people: z.array(personSchema).nullish().transform((v) => v ?? []) }),
  });
  return res.people;
}

// ── Vehicle collection / return ─────────────────────────────────────────────

export function recordInspection(fetch: BookingsFetch, body: Record<string, unknown> & { kind: InspectionKind }) {
  return fetch("/api/vehicles/inspections", { method: "POST", body, schema: ok });
}

/**
 * One photo, multipart, exactly as the web's inspection form uploads it:
 * fields file, booking_id, kind. The server stores it in the private
 * `vehicle-inspections` bucket under `${bookingId}/${kind}/…` and records
 * the file row (so the app never writes to that bucket itself).
 */
export function uploadInspectionPhoto(
  fetch: BookingsFetch,
  p: { bookingId: string; kind: PhotoKind; localUri: string; fileName: string; mimeType: string },
) {
  const form = new FormData();
  // React Native's FormData takes a { uri, name, type } file part.
  form.append("file", { uri: p.localUri, name: p.fileName, type: p.mimeType } as unknown as Blob);
  form.append("booking_id", p.bookingId);
  form.append("kind", p.kind);
  return fetch("/api/vehicles/inspections/upload", { method: "POST", body: form, schema: ok, timeoutMs: UPLOAD_TIMEOUT_MS });
}

// ── Errors in plain words ───────────────────────────────────────────────────

/** The server's words where it gave them, otherwise a plain next step. */
export function userMessage(err: unknown): string {
  if (err instanceof ServerRefusal) return err.message;
  if (err instanceof ApiError) {
    if (err.kind === "forbidden") return strings.common.forbidden;
    if (err.kind === "unauthenticated" || err.kind === "deactivated") return strings.common.signedOut;
    if (err.kind === "http" && err.status === 404) return strings.common.notFound;
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return strings.common.generic;
}

/** For useCachedLoad (must be a stable function): a 403 reads as "not on your account". */
export function loadErrorMessage(err: unknown): string {
  return isForbidden(err) ? strings.common.forbidden : userMessage(err);
}

export function isForbidden(err: unknown) {
  return err instanceof ApiError && err.kind === "forbidden";
}

/** Worth retrying by itself (connection, timeout, server hiccup)? */
export function isTransient(err: unknown) {
  if (!(err instanceof ApiError)) return true;
  if (err.kind === "network" || err.kind === "timeout") return true;
  return err.kind === "http" && (err.status ?? 500) >= 500;
}
