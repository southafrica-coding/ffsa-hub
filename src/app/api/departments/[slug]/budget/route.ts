import { NextResponse } from "next/server";
import { createAuditLog } from "@/services/audit";
import { badRequest, notFound, readJson, serverError } from "@/lib/departments/http";
import { isOpened, openDepartment } from "@/lib/departments/internal/open";
import { budgetLinks } from "@/lib/departments/shape";
import {
  createBudgetLink,
  getFinanceProject,
  listBudgetLinks,
  listProjectsById,
  updateBudgetLink,
} from "@/lib/departments/internal/repository";
import { parseBudgetCreate, parseBudgetPatch } from "@/lib/departments/validate";

export const dynamic = "force-dynamic";

async function payload(admin: Parameters<typeof listBudgetLinks>[0], departmentId: string, slug: string) {
  const links = await listBudgetLinks(admin, departmentId);
  if (links.error) return { error: links.error, body: null };
  const projects = await listProjectsById(
    admin,
    links.data.flatMap((link) => (link.finance_project_id ? [link.finance_project_id] : []))
  );
  if (projects.error) return { error: projects.error, body: null };
  return {
    error: null,
    body: budgetLinks(slug, links.data, new Map(projects.data.map((project) => [project.id, project.name]))),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "budget");
  if (!isOpened(opened)) return opened.response;
  const budget = await payload(opened.admin, opened.department.id, opened.department.slug);
  if (budget.error) return serverError(budget.error);
  return NextResponse.json({ ...budget.body, canEditBudget: opened.access.canEditBudget });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "budget");
  if (!isOpened(opened)) return opened.response;
  if (!opened.access.canEditBudget) return notFound("Department not found");
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseBudgetCreate(body.value);
  if (!parsed.ok) return badRequest(parsed.error);
  if (parsed.value.finance_project_id) {
    const project = await getFinanceProject(opened.admin, parsed.value.finance_project_id);
    if (project.error) return serverError(project.error);
    if (!project.data) return badRequest("finance_project_id must be a finance project id");
  }
  const created = await createBudgetLink(opened.admin, opened.department.id, parsed.value, opened.userId);
  if (created.error?.code === "23505") return badRequest("That project is already linked");
  if (created.error) return serverError(created.error);
  await createAuditLog(opened.supabase, {
    action: "department_budget.create",
    resource_type: "department_budget_link",
    resource_id: created.data?.id ?? "",
    changes: { after: parsed.value },
  });
  return NextResponse.json({ success: true, link: created.data });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const opened = await openDepartment((await params).slug, "budget");
  if (!isOpened(opened)) return opened.response;
  if (!opened.access.canEditBudget) return notFound("Department not found");
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseBudgetPatch(body.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const updated = await updateBudgetLink(
    opened.admin,
    opened.department.id,
    parsed.value.linkId,
    parsed.value.patch,
    opened.userId
  );
  if (updated.error) return serverError(updated.error);
  if (!updated.data) return notFound("Budget link not found");
  return NextResponse.json({ success: true, link: updated.data });
}
