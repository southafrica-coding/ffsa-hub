"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionBar, StatusPill } from "@/components/ffsa";
import {
  FINANCE_PROJECT_TYPES,
  FINANCE_PROJECT_TYPE_LABELS,
  recordCurrencyForOrg,
  type FinanceOrg,
  type FinanceProject,
  type FinanceProjectType,
} from "@/lib/finance/orgs";

/** Where a project stands against Xero. Names and status come from Xero. */
function xeroState(p: FinanceProject): { tone: "good" | "warn" | "quiet" | "bad"; label: string } {
  if (!p.is_active) {
    if (p.xero_option?.missing_since) return { tone: "quiet", label: "Gone from Xero" };
    if (p.xero_option?.status === "archived") return { tone: "quiet", label: "Archived in Xero" };
    return { tone: "quiet", label: p.xero_tracking_option_id ? "Archived" : "Not in Xero" };
  }
  if (p.xero_tracking_option_id) return { tone: "good", label: "From Xero" };
  return { tone: "warn", label: "Not linked yet" };
}

export function ProjectsList({
  orgs,
  projects,
  canEdit,
}: {
  orgs: FinanceOrg[];
  projects: FinanceProject[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState(projects);
  // A background Xero sync refreshes the page; take the new list.
  useEffect(() => setRows(projects), [projects]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const byId = useMemo(() => new Map(rows.map((p) => [p.id, p])), [rows]);
  const needle = search.trim().toLowerCase();

  async function saveType(project: FinanceProject, value: string) {
    const project_type = (value || null) as FinanceProjectType | null;
    setSaving(project.id);
    try {
      const res = await fetch(`/api/finance/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_type }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Could not save the type");
        return;
      }
      setRows((prev) => prev.map((p) => (p.id === project.id ? { ...p, project_type } : p)));
      toast.success(`${project.name}: ${project_type ? FINANCE_PROJECT_TYPE_LABELS[project_type] : "type cleared"}`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-7 px-5 py-6 md:px-8 md:py-7">
      <div className="max-w-sm">
        <Input
          placeholder="Search projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {orgs.map((org) => {
        const all = rows.filter((p) => p.org_id === org.id);
        const shown = needle ? all.filter((p) => p.name.toLowerCase().includes(needle)) : all;
        return (
          <div key={org.id} className="border border-ink">
            <SectionBar
              title={`${org.name} (${recordCurrencyForOrg(org)})`}
              meta={needle ? `${shown.length} of ${all.length}` : `${all.length} projects`}
            />
            <Table className="phone-stack">
              <TableHeader>
                <TableRow>
                  <TableHead>Project (Xero {org.projects_category_name})</TableHead>
                  <TableHead className="w-[180px]">Type</TableHead>
                  <TableHead className="w-[220px]">Linked in other org</TableHead>
                  <TableHead className="w-[150px]">In Xero</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => {
                  const linked = p.linked_project_id ? byId.get(p.linked_project_id) : null;
                  const state = xeroState(p);
                  return (
                    <TableRow key={p.id}>
                      <TableCell data-label="Project" className="text-sm">{p.name}</TableCell>
                      <TableCell data-label="Type">
                        <select
                          aria-label={`Type for ${p.name}`}
                          className="h-9 w-full border border-input bg-background px-2 text-sm disabled:opacity-60"
                          value={p.project_type ?? ""}
                          disabled={!canEdit || saving === p.id}
                          onChange={(e) => saveType(p, e.target.value)}
                        >
                          <option value="">Not set</option>
                          {FINANCE_PROJECT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {FINANCE_PROJECT_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell data-label="Linked" className="text-[13px] text-[color:var(--text-secondary)]">
                        {linked ? linked.name : "—"}
                      </TableCell>
                      <TableCell data-label="In Xero">
                        <StatusPill tone={state.tone}>{state.label}</StatusPill>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-[color:var(--text-secondary)]">
                      {all.length === 0
                        ? "No projects yet. They appear here once Xero has been read."
                        : "No project matches that search."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        );
      })}

      {orgs.length === 0 && (
        <p className="text-sm text-[color:var(--text-secondary)]">
          No finance organisations found. Migration 290 may not be applied yet.
        </p>
      )}
    </div>
  );
}
