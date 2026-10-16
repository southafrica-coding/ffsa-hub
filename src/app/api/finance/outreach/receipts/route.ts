import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createReceipt,
  deleteReceipt,
  getExpenseReceipts,
} from "@/services/outreach-finance";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const expenseId = searchParams.get("expense_id");

  if (!expenseId) {
    return NextResponse.json(
      { error: "expense_id is required" },
      { status: 400 }
    );
  }

  const { data: receipts, error } = await getExpenseReceipts(
    supabase,
    expenseId
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sign with the service role. The rows above were read through RLS, so
  // only receipts this user may see are here — but the FILES' storage
  // rules key on who uploaded them, and receipts filed by the server
  // (logged from Slack) have no uploader, so a user-signed URL fails.
  const storage = createAdminClient().storage.from("outreach-receipts");
  const withUrls = await Promise.all(
    (receipts ?? []).map(async (receipt: { file_path: string; [key: string]: unknown }) => {
      const { data } = await storage.createSignedUrl(receipt.file_path, 3600);
      return {
        ...receipt,
        signed_url: data?.signedUrl ?? null,
      };
    })
  );

  return NextResponse.json({ data: withUrls });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.expense_id || !body.file_path || !body.file_name) {
    return NextResponse.json(
      { error: "expense_id, file_path, and file_name are required" },
      { status: 400 }
    );
  }

  const { data, error } = await createReceipt(supabase, {
    ...body,
    uploaded_by: user.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const filePath = searchParams.get("file_path");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Delete the storage file if path provided
  if (filePath) {
    const adminClient = createAdminClient();
    await adminClient.storage.from("outreach-receipts").remove([filePath]);
  }

  // Delete the metadata record
  const { error } = await deleteReceipt(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
