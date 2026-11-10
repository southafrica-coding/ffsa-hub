import { NextResponse } from "next/server";

export function notAuthenticated() {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export function notAuthorized() {
  return NextResponse.json({ error: "Not authorized" }, { status: 403 });
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Clients never see database text. Details go to the server log. */
export function serverError(detail?: unknown) {
  if (detail !== undefined) console.error(detail);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false };
  }
}
