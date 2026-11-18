import { NextResponse } from "next/server";
import { MISSIO_PEOPLE_ROLES, MISSIO_SLUG, requireOrgRole, type OrgAccess } from "@/lib/missio/access";
import { pastorAvailabilityLimit } from "@/lib/missio/availability/limit";

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function fromResult(
  result:
    | { ok: true; body: unknown }
    | { ok: false; status: number; error: string; code: string }
) {
  if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
  return json(result.body);
}

export async function readJson(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: json({ error: "Check the fields and try again.", code: "invalid_input" }, 400) };
  }
}

export function appOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

export async function withPastor(
  bucket: "write" | "link" | "nudge" | null,
  run: (auth: OrgAccess) => Promise<NextResponse>
) {
  const auth = await requireOrgRole(MISSIO_SLUG, MISSIO_PEOPLE_ROLES);
  if ("response" in auth) return auth.response;
  if (bucket) {
    const limited = await pastorAvailabilityLimit(auth.user.id, bucket);
    if (limited) return limited;
  }
  try {
    return await run(auth);
  } catch (error) {
    console.error("[missio-availability]", error instanceof Error ? error.message : "request failed");
    return json({ error: "Volunteers aren't available right now.", code: "server_error" }, 500);
  }
}
