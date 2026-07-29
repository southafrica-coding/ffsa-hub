import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  upsertBrandKit,
  type BrandKitPatch,
  type SocialLink,
  type SocialPlatform,
} from "@/services/brand";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";

function isHexColor(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

function asStringOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") return v;
  return undefined;
}

function asColorOrNull(
  v: unknown,
  key: string
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === "") return { ok: true, value: null };
  if (isHexColor(v)) return { ok: true, value: v };
  return { ok: false, error: `${key} must be a hex color like #RRGGBB` };
}

const SOCIAL_PLATFORMS: SocialPlatform[] = [
  "instagram",
  "facebook",
  "youtube",
  "x",
  "tiktok",
  "web",
];

function isSocialPlatform(s: unknown): s is SocialPlatform {
  return typeof s === "string" && SOCIAL_PLATFORMS.includes(s as SocialPlatform);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ identityId: string }> }
) {
  const { identityId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id, ["communications.manage_brand_kits"]))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Confirm the identity exists before upserting (FK would catch it, but
  // a friendlier 404 is nicer than a 500).
  const { data: identity } = await supabase
    .from("sending_identities")
    .select("id")
    .eq("id", identityId)
    .maybeSingle();
  if (!identity) {
    return NextResponse.json({ error: "Sending identity not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: BrandKitPatch = {};

  for (const colorKey of [
    "primary_color",
    "accent_color",
    "text_color",
    "bg_color",
  ] as const) {
    if (!(colorKey in body)) continue;
    const r = asColorOrNull(body[colorKey], colorKey);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    if (r.value !== undefined) patch[colorKey] = r.value;
  }

  for (const stringKey of [
    "logo_url",
    "display_font",
    "body_font",
    "org_name",
    "org_address",
    "footer_tagline",
  ] as const) {
    if (!(stringKey in body)) continue;
    const v = asStringOrNull(body[stringKey]);
    if (v !== undefined) patch[stringKey] = v;
  }

  if ("social_links" in body) {
    const raw = body.social_links;
    if (!Array.isArray(raw)) {
      return NextResponse.json(
        { error: "social_links must be an array" },
        { status: 400 }
      );
    }
    const cleaned: SocialLink[] = [];
    for (const item of raw as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const obj = item as { platform?: unknown; url?: unknown };
      if (!isSocialPlatform(obj.platform)) continue;
      if (typeof obj.url !== "string" || !/^https?:\/\//i.test(obj.url)) continue;
      cleaned.push({ platform: obj.platform, url: obj.url });
    }
    patch.social_links = cleaned;
  }

  const { data, error } = await upsertBrandKit(supabase, identityId, patch, user.id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brand: data });
}
