"use client";

import { useMemo, useState } from "react";
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
    <div className="space-y-7 px-8 py-7">
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project (Xero {org.projects_category_name})</TableHead>
                  <TableHead className="w-[180px]">Type</TableHead>
                  <TableHead className="w-[220px]">Linked in other org</TableHead>
                  <TableHead className="w-[110px]">State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => {
                  const linked = p.linked_project_id ? byId.get(p.linked_project_id) : null;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{p.name}</TableCell>
                      <TableCell>
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
                      <TableCell className="text-[13px] text-[color:var(--text-secondary)]">
                        {linked ? linked.name : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={p.is_active ? "good" : "quiet"}>
                          {p.is_active ? "Active" : "Archived"}
                        </StatusPill>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-[color:var(--text-secondary)]">
                      {all.length === 0 ? "No projects yet." : "No project matches that search."}
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
