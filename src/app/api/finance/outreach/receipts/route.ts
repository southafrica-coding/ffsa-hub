import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createReceipt,
  deleteReceipt,
  getExpenseReceipts,
  getReceiptByPath,
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

  // The phone app retries after a dropped connection with the same file
  // path, so a receipt already registered for this file is the answer, not a
  // second row. The website builds a fresh path for every upload.
  const { data: existing } = await getReceiptByPath(supabase, body.expense_id, body.file_path);
  if (existing) {
    return NextResponse.json({ success: true, data: existing, replayed: true });
  }

  const { data, error } = await createReceipt(supabase, {
    ...body,
    uploaded_by: user.id,
  });

  if (error) {
    // Row-level security said no (Postgres 42501): a permission answer, so
    // the phone app stops retrying and tells the person.
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "You don't have permission to add receipts to this expense" },
        { status: 403 }
      );
    }
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

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Delete the record through RLS first; only a row this person was allowed
  // to delete releases its file, and the path comes from that row — never
  // from the request.
  const { data, error } = await deleteReceipt(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "You can't delete this receipt" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  await adminClient.storage
    .from("outreach-receipts")
    .remove(data.map((r: { file_path: string }) => r.file_path));

  return NextResponse.json({ success: true });
}
