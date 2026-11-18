import { NextResponse } from "next/server";
import { hashAvailabilityToken, AVAILABILITY_TOKEN_PATTERN } from "@/lib/missio/availability/token";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { firstIssue, publicSaveSchema } from "@/lib/missio/availability/schema";
import { adminClient, loadPublicAvailability, savePublicAvailability } from "@/lib/missio/availability/service";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

async function limited(request: Request, raw: string, bucket: "read" | "write") {
  const tokenHash = AVAILABILITY_TOKEN_PATTERN.test(raw) ? hashAvailabilityToken(raw) : undefined;
  return serveAvailabilityLimit(request, bucket, tokenHash);
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const gate = await limited(request, token, "read");
  if (gate) {
    gate.headers.set("X-Robots-Tag", "noindex");
    return gate;
  }
  try {
    const result = await loadPublicAvailability(adminClient(), token);
    if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
    return json(result.body);
  } catch (error) {
    console.error("[serve/missio]", error instanceof Error ? error.message : "lookup failed");
    return json({ error: "Missio didn't load this link.", code: "server_error" }, 500);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const gate = await limited(request, token, "write");
  if (gate) {
    gate.headers.set("X-Robots-Tag", "noindex");
    return gate;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const parsed = publicSaveSchema.safeParse(body);
  if (!parsed.success) return json({ error: firstIssue(parsed.error), code: "invalid_input" }, 400);
  try {
    const result = await savePublicAvailability(adminClient(), token, parsed.data);
    if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
    return json(result.body);
  } catch (error) {
    console.error("[serve/missio]", error instanceof Error ? error.message : "save failed");
    return json({ error: "That Sunday didn't save.", code: "server_error" }, 500);
  }
}
