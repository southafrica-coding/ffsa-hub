// Small helpers shared by the Store route handlers.
import { NextResponse } from "next/server";

export const NO_STORE = { "Cache-Control": "no-store" };

export function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
