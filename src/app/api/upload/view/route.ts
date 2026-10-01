import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  // Require authentication — only logged-in admins/users can view uploads
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");

  const applicationId = searchParams.get("applicationId");

  if (!path || !path.startsWith("applications/") || !applicationId) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Authorise through the USER client: RLS on application_responses decides
  // who may read the application (school scope, applicant self, and the
  // 6-month expiry lock from migration 223). The file must also be one of
  // that application's answers, so a readable application can't be used to
  // sign someone else's upload.
  const { data: application } = await supabase
    .from("application_responses")
    .select("id, answers")
    .eq("id", applicationId)
    .maybeSingle();

  if (!application || !JSON.stringify(application.answers ?? null).includes(path)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const adminSupabase = createAdminClient();

  // Check if file is HEIC/HEIF — browsers can't display these natively
  const isHeic = /\.heic$/i.test(path) || /\.heif$/i.test(path);

  if (isHeic) {
    // Try to get a transformed (JPEG) version first
    const { data: transformedData } = await adminSupabase.storage
      .from("application-uploads")
      .createSignedUrl(path, 3600, {
        transform: { format: "origin", width: 800, quality: 80 },
      });

    if (transformedData?.signedUrl) {
      return NextResponse.json({
        url: transformedData.signedUrl,
        isHeic: true,
      });
    }
  }

  // Standard signed URL (works for JPEG, PNG, WebP, etc.)
  const { data, error } = await adminSupabase.storage
    .from("application-uploads")
    .createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "Failed to generate URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: data.signedUrl, isHeic });
}
