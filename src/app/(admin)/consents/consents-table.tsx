"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export type ConsentRow = {
  recordId: string;
  person: string;
  email: string;
  policyTitle: string;
  version: string;
  source: string;
  acceptedAt: string; // ISO
  ip: string;
};

function fmt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(ms));
}

// Escape a value for CSV (quote if it contains comma/quote/newline).
function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function ConsentsTable({
  rows,
  versions,
}: {
  rows: ConsentRow[];
  versions: { version: string; title: string }[];
}) {
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (version && r.version !== version) return false;
      if (!q) return true;
      return (
        r.person.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.policyTitle.toLowerCase().includes(q)
      );
    });
  }, [rows, search, version]);

  const exportCsv = () => {
    const header = [
      "Person",
      "Email",
      "Policy",
      "Version",
      "Source",
      "Signed at (SAST)",
      "IP address",
    ];
    const lines = [header, ...filtered.map((r) => [
      r.person,
      r.email,
      r.policyTitle,
      r.version,
      r.source,
      fmt(r.acceptedAt),
      r.ip,
    ])]
      .map((cols) => cols.map(csvCell).join(","))
      .join("\n");
    const blob = new Blob([lines], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "consent-records.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search person, email or policy…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All policies</option>
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              {v.title} ({v.version})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "record" : "records"}
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Policy</th>
              <th className="px-3 py-2 font-medium">Version</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Signed</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No matching records.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.recordId} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.person}</div>
                    {r.email && (
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.policyTitle}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.version}</td>
                  <td className="px-3 py-2 capitalize">{r.source}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(r.acceptedAt)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.ip || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={`/print/agreements/${r.recordId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
