import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEvangelismAccess, type EvangelismAccess } from "@/lib/auth/check-evangelism-access";
import { isEvangelismNotReady } from "./schema-error";

export const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function notEnabled() {
  return json(
    {
      error: "evangelism_not_enabled",
      message: "Evangelism stories are not available yet.",
    },
    503
  );
}

export function asError(error: unknown, fallback: string) {
  if (isEvangelismNotReady(error)) return notEnabled();
  console.error("[evangelism]", fallback, error instanceof Error ? error.message : "");
  return json({ error: "server_error", message: fallback }, 500);
}

export async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

type Guard =
  | { supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string }; access: EvangelismAccess }
  | { response: NextResponse };

export async function guardEvangelism(): Promise<Guard> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { response: json({ error: "unauthenticated", message: "Sign in to use this endpoint." }, 401) };
  }
  const access = await getEvangelismAccess(supabase, user.id);
  return { supabase, user, access };
}

export function isGuard(result: Guard): result is { response: NextResponse } {
  return "response" in result;
}
