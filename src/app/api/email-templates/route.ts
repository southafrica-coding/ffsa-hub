import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  listEmailTemplates,
  createEmailTemplate,
} from "@/services/email-templates";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";
import type { CampaignBody } from "@/lib/campaigns/blocks";

// GET /api/email-templates — list saved custom templates.
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await listEmailTemplates(supabase);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

// POST /api/email-templates — save the current email layout as a template.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: {
    name?: string;
    tagline?: string | null;
    body_source?: CampaignBody;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (
    !body.body_source ||
    typeof body.body_source !== "object" ||
    !Array.isArray((body.body_source as CampaignBody).blocks)
  ) {
    return NextResponse.json({ error: "body_source is required" }, { status: 400 });
  }

  const { data, error } = await createEmailTemplate(supabase, {
    name: body.name.trim(),
    tagline: body.tagline ?? null,
    body_source: body.body_source,
    created_by: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}
