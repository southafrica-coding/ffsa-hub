import { NextResponse } from "next/server";
import { MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { deleteMissioFinanceEntry, saveMissioFinanceEntry } from "@/services/missio-finance";
import { entryView, isMissingTableError } from "@/lib/missio/finance/server";
import { MISSIO_FINANCE_ROLES, readEntryInput, readEntryKey } from "@/lib/missio/finance/entry-input";
import { todayInSast } from "@/lib/missio/finance/report";

// POST   /api/missio/finance/entries   save one month's cash or FundraiseUp amount
// DELETE /api/missio/finance/entries?source=cash&month=YYYY-MM
//
// Missio pastors only. Writes go through the pastor's own client, so RLS
// (migration 394) has the last word; a trigger records who changed what.
// Until 394 is applied both answer 503 with a plain explanation.

export const dynamic = "force-dynamic";

const NOT_INSTALLED = {
  error: "Cash and FundraiseUp entries aren't switched on yet. The database update for them hasn't been applied.",
  code: "not_installed",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const access = await requireOrgRole(MISSIO_SLUG, MISSIO_FINANCE_ROLES);
  if ("response" in access) return access.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);
  }
  const input = readEntryInput(raw, todayInSast());
  if (!input.ok) return json({ error: "Check the fields and try again.", code: "invalid_input", fieldErrors: input.fieldErrors }, 400);

  const { data, error } = await saveMissioFinanceEntry(access.supabase, { orgId: access.orgId, ...input.entry });
  if (error) {
    if (isMissingTableError(error)) return json(NOT_INSTALLED, 503);
    if (error.code === "42501") return json({ error: "Not authorized", code: "forbidden" }, 403);
    console.error("[missio finance] save failed", error.code ?? "", (error.message ?? "").slice(0, 120));
    return json({ error: "Something went wrong.", code: "server_error" }, 500);
  }
  return json({ entry: data ? entryView(data) : null });
}

export async function DELETE(request: Request) {
  const access = await requireOrgRole(MISSIO_SLUG, MISSIO_FINANCE_ROLES);
  if ("response" in access) return access.response;

  const key = readEntryKey(new URL(request.url).searchParams);
  if (!key) return json({ error: "Check the fields and try again.", code: "invalid_input" }, 400);

  const { error } = await deleteMissioFinanceEntry(access.supabase, { orgId: access.orgId, ...key });
  if (error) {
    if (isMissingTableError(error)) return json(NOT_INSTALLED, 503);
    console.error("[missio finance] delete failed", error.code ?? "", (error.message ?? "").slice(0, 120));
    return json({ error: "Something went wrong.", code: "server_error" }, 500);
  }
  return json({ ok: true });
}
