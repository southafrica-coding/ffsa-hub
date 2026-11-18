import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, normalizePhoneE164 } from "@/lib/phone";
import { clientIp, getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import { connectRateKeyHash } from "@/lib/missio/match-token";
import { MISSIO_SLUG } from "@/lib/missio/access";
import type { ConnectFieldErrors, ConnectVisitType } from "@/lib/missio/types";

// Public QR connect card. No session. Inserts with the service role because
// migration 332 grants anon nothing and limits authenticated inserts to
// source = 'manual'. This path only writes source 'qr'.
//
// A match sets matched_contact_id only for a contact who already has a
// Missio org_people row. An FFSA-wide contact is left unmatched.
// matched_by stays null. Matching never creates org_people and never fails
// the submit.
// The response is always { ok: true } — no ids, no contact fields.
// rate_key_hash is an HMAC of the client IP (connectRateKeyHash). Never the raw IP.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const VISIT = ["first_time", "been_a_while", "regular"] as const;

/** Per IP, about five cards in ten minutes. */
export const CONNECT_IP_LIMIT = 5;
export const CONNECT_WINDOW_SECONDS = 10 * 60;
/** Flood cap across every IP. A full service can still submit. */
export const CONNECT_GLOBAL_LIMIT = 200;
const DEDUPE_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_CAMPUS = "potch";

const RATE_LIMITED = {
  error: "Too many attempts. Try again shortly.",
  code: "rate_limited" as const,
};

type SubmitResult =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown>; headers?: Record<string, string> };

function invalid(fieldErrors: ConnectFieldErrors): SubmitResult {
  return {
    ok: false,
    status: 400,
    body: { error: "Check the fields and try again.", code: "invalid_input", fieldErrors },
  };
}

function serverError(scope: string, detail?: string): SubmitResult {
  console.error(`[missio] ${scope}`, detail ?? "failed");
  return { ok: false, status: 500, body: { error: "Something went wrong.", code: "server_error" } };
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function splitName(name: string): { first: string; last: string } {
  const trimmed = collapse(name);
  const space = trimmed.indexOf(" ");
  if (space === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, space), last: trimmed.slice(space + 1).trim() };
}

function adminClient(): { client: Client } | { error: string } {
  try {
    return { client: createAdminClient() };
  } catch (error) {
    console.error("[missio] admin client unavailable", error instanceof Error ? error.message : "missing env");
    return { error: "Something went wrong." };
  }
}

function badBody(): { ok: false; status: number; body: Record<string, unknown> } {
  return {
    ok: false,
    status: 400,
    body: { error: "Check the fields and try again.", code: "invalid_input", fieldErrors: {} },
  };
}

export async function readCappedBody(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; body: Record<string, unknown> }> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return badBody();
  let text: string;
  try {
    text = await request.text();
  } catch {
    return badBody();
  }
  if (text.length > MAX_BODY_BYTES) return badBody();
  if (!text.trim()) return badBody();
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return badBody();
  }
}

function honeypotTripped(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const website = (body as { website?: unknown }).website;
  if (website == null) return false;
  if (typeof website === "string") return website.trim().length > 0;
  return true;
}

const emptyToUndefined = (value: unknown) => {
  if (value == null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(1).max(40),
  email: z.preprocess(emptyToUndefined, z.string().trim().max(320).optional()),
  visitType: z.enum(VISIT),
  wantsHouseChurch: z.boolean(),
  wantsPrayer: z.preprocess(emptyToUndefined, z.boolean().optional()),
  prayerRequest: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
});

function fieldErrorsFrom(error: z.ZodError): ConnectFieldErrors {
  const out: ConnectFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (key === "name" && !out.name) out.name = "Enter a name between 2 and 80 characters.";
    if (key === "phone" && !out.phone) out.phone = "Enter a valid phone number.";
    if (key === "email" && !out.email) out.email = "That email address isn't valid.";
    if (key === "visitType" && !out.visitType) out.visitType = "Choose first time, been a while, or regular.";
    if (key === "prayerRequest" && !out.prayerRequest) out.prayerRequest = "Keep the prayer request under 1000 characters.";
    if (key === "notes" && !out.notes) out.notes = "Keep notes under 1000 characters.";
  }
  return out;
}

async function limitConnect(ip: string): Promise<SubmitResult | null> {
  const limiter = getRateLimiter();
  const perIp = await limiter.hit(`missio:connect:ip:${ip}`, {
    limit: CONNECT_IP_LIMIT,
    windowSeconds: CONNECT_WINDOW_SECONDS,
  });
  if (!perIp.allowed) {
    return {
      ok: false,
      status: 429,
      body: RATE_LIMITED,
      headers: { "Retry-After": String(retryAfterSeconds(perIp)) },
    };
  }
  const global = await limiter.hit("missio:connect:global", {
    limit: CONNECT_GLOBAL_LIMIT,
    windowSeconds: CONNECT_WINDOW_SECONDS,
  });
  if (!global.allowed) {
    return {
      ok: false,
      status: 429,
      body: RATE_LIMITED,
      headers: { "Retry-After": String(retryAfterSeconds(global)) },
    };
  }
  return null;
}

async function missioOrgId(admin: Client): Promise<{ orgId: string } | SubmitResult> {
  const org = await admin.from("organisations").select("id").eq("slug", MISSIO_SLUG).maybeSingle();
  if (org.error || !org.data?.id) return serverError("connect org lookup", org.error?.code ?? org.error?.message);
  return { orgId: org.data.id as string };
}

async function contactIds(
  admin: Client,
  table: "contact_phones" | "contact_emails",
  column: "phone_normalized" | "email_normalized",
  value: string
): Promise<string[] | null> {
  const { data, error } = await admin.from(table).select("contact_id").eq(column, value).limit(5);
  if (error) {
    console.error("[missio] connect match failed", error.code ?? table);
    return null;
  }
  return [
    ...new Set(
      ((data ?? []) as Array<{ contact_id?: string }>)
        .map((row) => row.contact_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
}

/** Missio org_people ids among candidates. Null when the lookup fails. */
async function missioContactIds(admin: Client, orgId: string, ids: string[]): Promise<string[] | null> {
  if (ids.length === 0) return [];
  const { data, error } = await admin.from("org_people").select("contact_id").eq("org_id", orgId).in("contact_id", ids);
  if (error) {
    console.error("[missio] connect org match failed", error.code ?? "org_people");
    return null;
  }
  return [
    ...new Set(
      ((data ?? []) as Array<{ contact_id?: string }>)
        .map((row) => row.contact_id)
        .filter((id): id is string => typeof id === "string" && ids.includes(id))
    ),
  ];
}

/**
 * Phone, then email, then a unique case-sensitive full name.
 * A step that finds any contact only keeps Missio org_people.
 * Zero Missio rows, or more than one, stops the search. It does not
 * fall through to the next step, and it does not keep an FFSA-wide id.
 * A lookup error is "no match".
 */
async function matchContact(
  admin: Client,
  orgId: string,
  phone: string,
  email: string | null,
  name: string
): Promise<string | null> {
  const byPhone = await contactIds(admin, "contact_phones", "phone_normalized", phone);
  if (byPhone === null) return null;
  if (byPhone.length > 1) return null;
  if (byPhone.length === 1) {
    const inOrg = await missioContactIds(admin, orgId, byPhone);
    if (inOrg === null || inOrg.length !== 1) return null;
    return inOrg[0];
  }

  if (email) {
    const byEmail = await contactIds(admin, "contact_emails", "email_normalized", email);
    if (byEmail === null) return null;
    if (byEmail.length > 1) return null;
    if (byEmail.length === 1) {
      const inOrg = await missioContactIds(admin, orgId, byEmail);
      if (inOrg === null || inOrg.length !== 1) return null;
      return inOrg[0];
    }
  }

  const { first, last } = splitName(name);
  if (!first) return null;
  if (last) {
    const named = await admin.from("contacts").select("id").eq("first_name", first).eq("last_name", last).limit(2);
    if (named.error) {
      console.error("[missio] connect name match failed", named.error.code ?? "query");
      return null;
    }
    const ids = ((named.data ?? []) as Array<{ id?: string }>)
      .map((row) => row.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length !== 1) return null;
    const inOrg = await missioContactIds(admin, orgId, ids);
    if (inOrg === null || inOrg.length !== 1) return null;
    return inOrg[0];
  }

  const [emptyLast, nullLast] = await Promise.all([
    admin.from("contacts").select("id").eq("first_name", first).eq("last_name", "").limit(2),
    admin.from("contacts").select("id").eq("first_name", first).is("last_name", null).limit(2),
  ]);
  if (emptyLast.error || nullLast.error) return null;
  const ids = [
    ...new Set(
      [...((emptyLast.data ?? []) as Array<{ id?: string }>), ...((nullLast.data ?? []) as Array<{ id?: string }>)]
        .map((row) => row.id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (ids.length !== 1) return null;
  const inOrg = await missioContactIds(admin, orgId, ids);
  if (inOrg === null || inOrg.length !== 1) return null;
  return inOrg[0];
}

export async function submitConnectCard(args: { body: unknown; ip: string }): Promise<SubmitResult> {
  if (honeypotTripped(args.body)) return { ok: true };

  const parsed = bodySchema.safeParse(args.body);
  const fieldErrors: ConnectFieldErrors = parsed.success ? {} : fieldErrorsFrom(parsed.error);
  const raw = args.body && typeof args.body === "object" && !Array.isArray(args.body) ? (args.body as Record<string, unknown>) : {};
  if (!fieldErrors.phone && typeof raw.phone === "string" && raw.phone.trim() && !normalizePhoneE164(raw.phone)) {
    fieldErrors.phone = "Enter a valid phone number.";
  }
  let email: string | null = null;
  if (!fieldErrors.email && typeof raw.email === "string" && raw.email.trim()) {
    const normalized = normalizeEmail(raw.email);
    const domain = normalized?.split("@")[1] ?? "";
    if (!normalized || !domain.includes(".")) fieldErrors.email = "That email address isn't valid.";
    else email = normalized;
  }
  if (!parsed.success || Object.keys(fieldErrors).length > 0) return invalid(fieldErrors);
  const phone = normalizePhoneE164(parsed.data.phone);
  if (!phone) return invalid({ ...fieldErrors, phone: "Enter a valid phone number." });
  if (parsed.data.email && !email) {
    email = normalizeEmail(parsed.data.email);
  }

  const limited = await limitConnect(args.ip);
  if (limited) return limited;

  const rateKey = connectRateKeyHash(args.ip);
  if (!rateKey) return serverError("connect rate key missing");

  const admin = adminClient();
  if ("error" in admin) return serverError("connect admin");
  const org = await missioOrgId(admin.client);
  if ("ok" in org) return org;

  const cutoff = new Date(Date.now() - DEDUPE_MS).toISOString();
  const recent = await admin.client
    .from("connect_responses")
    .select("id")
    .eq("org_id", org.orgId)
    .eq("phone", phone)
    .gte("submitted_at", cutoff)
    .limit(1);
  if (recent.error) return serverError("connect dedupe", recent.error.code ?? "query");
  if ((recent.data ?? []).length > 0) return { ok: true };

  let matchedContactId: string | null = null;
  let matchedAt: string | null = null;
  try {
    matchedContactId = await matchContact(admin.client, org.orgId, phone, email, collapse(parsed.data.name));
    if (matchedContactId) matchedAt = new Date().toISOString();
  } catch (error) {
    console.error("[missio] connect match threw", error instanceof Error ? error.name : "error");
    matchedContactId = null;
    matchedAt = null;
  }

  const inserted = await admin.client.from("connect_responses").insert({
    org_id: org.orgId,
    name: collapse(parsed.data.name),
    phone,
    email: parsed.data.email?.trim() || null,
    visit_type: parsed.data.visitType as ConnectVisitType,
    wants_house_church: parsed.data.wantsHouseChurch,
    wants_prayer: parsed.data.wantsPrayer ?? false,
    prayer_request: parsed.data.prayerRequest?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
    campus: DEFAULT_CAMPUS,
    source: "qr",
    rate_key_hash: rateKey,
    matched_contact_id: matchedContactId,
    matched_by: null,
    matched_at: matchedAt,
  });
  if (inserted.error) return serverError("connect insert", inserted.error.code ?? "insert");
  return { ok: true };
}

export function connectClientIp(request: Request): string {
  return clientIp(request);
}
