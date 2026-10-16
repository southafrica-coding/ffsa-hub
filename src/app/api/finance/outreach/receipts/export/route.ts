import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getOutreachTeamById,
  getTeamExpenses,
} from "@/services/outreach-finance";
import JSZip from "jszip";

export const maxDuration = 60;

/** A ZIP-safe name chunk. */
const part = (s: string | null | undefined) =>
  String(s ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  const [{ data: team }, { data: expenses }] = await Promise.all([
    getOutreachTeamById(supabase, teamId),
    getTeamExpenses(supabase, teamId),
  ]);

  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  // Get all receipts for this team's expenses
  const expenseIds = (expenses ?? []).map(
    (e: { id: string }) => e.id
  );

  if (expenseIds.length === 0) {
    return NextResponse.json(
      { error: "No expenses found for this team" },
      { status: 404 }
    );
  }

  // Rows through RLS (only what this user may see)…
  const { data: receipts } = await supabase
    .from("outreach_receipts")
    .select("*")
    .in("expense_id", expenseIds)
    .order("uploaded_at", { ascending: true });

  // …files through the service role: storage rules key on who uploaded a
  // file, and receipts filed by the server (logged from Slack) have none.
  const storage = createAdminClient().storage.from("outreach-receipts");

  if (!receipts || receipts.length === 0) {
    return NextResponse.json(
      { error: "No receipts found for this team" },
      { status: 404 }
    );
  }

  // Build expense lookup map
  const expenseMap: Record<
    string,
    {
      expense_date: string;
      receipt_code: string | null;
      vendor: string | null;
      zar_amount: number | null;
      category: string | null;
    }
  > = {};
  for (const exp of expenses ?? []) {
    expenseMap[exp.id] = {
      expense_date: exp.expense_date,
      receipt_code: exp.receipt_code,
      vendor: exp.vendor,
      zar_amount: exp.zar_amount,
      category: exp.outreach_budget_categories?.name ?? null,
    };
  }

  // Create ZIP
  const zip = new JSZip();

  // Add manifest CSV
  const manifestLines = [
    "File,Expense Date,Receipt Code,Vendor,Category,Amount (ZAR),Original File Name,File Size,Mime Type",
  ];
  const missing: string[] = [];
  const used = new Set<string>();

  let fileCount = 0;

  for (const receipt of receipts) {
    const expense = expenseMap[receipt.expense_id];
    if (!expense) continue;

    const { data: fileData, error: downloadError } = await storage.download(receipt.file_path);
    if (downloadError || !fileData) {
      console.error("[receipts/export] download failed", receipt.file_path, downloadError);
      missing.push(`${expense.expense_date} ${expense.vendor ?? ""} — ${receipt.file_name}`);
      continue;
    }

    // One flat folder, every name unique and readable:
    // 2026-03-24_Choppies_0042.jpg — a second receipt on the same expense
    // gets _2, so two phones' "image.jpg" can never overwrite each other.
    const ext = (receipt.file_name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "").toLowerCase();
    const base =
      [expense.expense_date, part(expense.vendor), part(expense.receipt_code)].filter(Boolean).join("_") ||
      "receipt";
    let name = `${base}${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}${ext}`;
    used.add(name.toLowerCase());
    const filePath = `receipts/${name}`;

    zip.file(filePath, await fileData.arrayBuffer());

    manifestLines.push(
      [
        filePath,
        expense.expense_date,
        expense.receipt_code ?? "",
        expense.vendor ?? "",
        expense.category ?? "",
        expense.zar_amount ?? "",
        receipt.file_name,
        receipt.file_size,
        receipt.mime_type,
      ]
        .map((v) => {
          const s = String(v ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    );

    fileCount++;
  }

  if (fileCount === 0) {
    return NextResponse.json(
      { error: "No receipt files could be downloaded" },
      { status: 500 }
    );
  }

  // Add manifest (and say plainly if any file couldn't be fetched)
  zip.file("manifest.csv", manifestLines.join("\n"));
  if (missing.length) {
    zip.file("MISSING.txt", `These receipts are recorded but their files couldn't be fetched:\n\n${missing.join("\n")}\n`);
  }

  // Generate ZIP
  const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

  const filename = `${team.team_name.replace(/[^a-zA-Z0-9]/g, "_")}_receipts.zip`;

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
