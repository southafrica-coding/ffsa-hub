"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";

type Category = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
};

type ParsedRow = {
  header: string;
  amount: number;
  peopleCount: number | null;
  matchedCategory: Category | null;
  manualCategoryId: string | null;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Strips currency formatting like "R12,000.00" or "R 1 200" → 12000
function parseCurrency(value: unknown): number {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "")
    .replace(/[R$€£\s]/g, "")
    .replace(/,/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function matchCategory(
  header: string,
  categories: Category[]
): Category | null {
  const headerLower = header.toLowerCase().trim();
  const headerSlug = slugify(header);

  // Pass 1: exact match
  for (const cat of categories) {
    if (cat.name.toLowerCase() === headerLower) return cat;
  }
  // Pass 2: slug match
  for (const cat of categories) {
    if (cat.slug === headerSlug) return cat;
  }
  // Pass 3: fuzzy match
  for (const cat of categories) {
    const catLower = cat.name.toLowerCase();
    if (headerLower.includes(catLower) || catLower.includes(headerLower)) {
      return cat;
    }
  }
  return null;
}

export function BudgetImport({
  teamId,
  categories,
}: {
  teamId: string;
  categories: Category[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [imported, setImported] = useState(false);

  function parseVariableCostSheet(rawRows: unknown[][]): ParsedRow[] | null {
    // Detect FFSA variable cost format:
    // header row contains "Amount", "Frequency", "People", "Total"
    // data rows: col[1] = category name, col[5] = total budget
    let dataStart = -1;
    for (let i = 0; i < rawRows.length; i++) {
      const cells = (rawRows[i] as unknown[]).map((c) =>
        String(c ?? "").toLowerCase().trim()
      );
      if (
        cells.includes("amount") &&
        cells.includes("total") &&
        cells.includes("people")
      ) {
        dataStart = i + 1;
        break;
      }
    }
    if (dataStart === -1) return null;

    // Aggregate totals by matched category (multiple destination rows → one budget line)
    const aggregated = new Map<
      string,
      { displayName: string; total: number; matched: Category | null }
    >();

    for (let i = dataStart; i < rawRows.length; i++) {
      const row = rawRows[i] as unknown[];
      const name = String(row[1] ?? "").trim();
      const total = parseCurrency(row[5]);
      if (!name || total <= 0) continue;
      if (name.toLowerCase() === "total") continue;

      const matched = matchCategory(name, categories);
      // Use matched category id as key so destinations aggregate correctly
      const key = matched ? matched.id : name.toLowerCase();

      if (aggregated.has(key)) {
        aggregated.get(key)!.total += total;
      } else {
        aggregated.set(key, { displayName: name, total, matched });
      }
    }

    if (aggregated.size === 0) return null;

    return Array.from(aggregated.values()).map((item) => ({
      header: item.displayName,
      amount: Math.round(item.total * 100) / 100,
      peopleCount: null,
      matchedCategory: item.matched,
      manualCategoryId: null,
    }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        // --- Try FFSA variable-cost format first (raw array parse) ---
        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
        });
        const variableCostParsed = parseVariableCostSheet(rawRows);
        if (variableCostParsed && variableCostParsed.length > 0) {
          setRows(variableCostParsed);
          setImported(false);
          return;
        }

        // --- Fall back to standard formats ---
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
        if (json.length === 0) {
          toast.error("Spreadsheet is empty");
          return;
        }

        const headers = Object.keys(json[0]);
        const hasCategory = headers.some((h) =>
          h.toLowerCase().includes("category")
        );
        const hasAmount = headers.some(
          (h) =>
            h.toLowerCase().includes("amount") ||
            h.toLowerCase().includes("budget")
        );

        let parsed: ParsedRow[] = [];

        if (hasCategory && hasAmount) {
          // Long format: each row is a category with Category + Amount columns
          const catCol = headers.find((h) =>
            h.toLowerCase().includes("category")
          )!;
          const amtCol = headers.find(
            (h) =>
              h.toLowerCase().includes("amount") ||
              h.toLowerCase().includes("budget")
          )!;
          const peopleCol = headers.find((h) =>
            h.toLowerCase().includes("people")
          );

          for (const row of json) {
            const catName = String(row[catCol] ?? "").trim();
            const amount = parseCurrency(row[amtCol]);
            const people = peopleCol
              ? parseCurrency(row[peopleCol]) || null
              : null;
            if (!catName || amount <= 0) continue;

            parsed.push({
              header: catName,
              amount,
              peopleCount: people,
              matchedCategory: matchCategory(catName, categories),
              manualCategoryId: null,
            });
          }
        } else {
          // Wide format: column headers are category names, first row has amounts
          const firstRow = json[0];
          for (const header of headers) {
            const value = parseCurrency(firstRow[header]);
            if (value <= 0) continue;

            parsed.push({
              header,
              amount: value,
              peopleCount: null,
              matchedCategory: matchCategory(header, categories),
              manualCategoryId: null,
            });
          }
        }

        if (parsed.length === 0) {
          toast.error("No valid budget data found in spreadsheet");
          return;
        }

        setRows(parsed);
        setImported(false);
      } catch {
        toast.error("Failed to parse spreadsheet");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleManualMatch(index: number, categoryId: string) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, manualCategoryId: categoryId } : r
      )
    );
  }

  async function handleImport() {
    setLoading(true);
    try {
      const importRows = rows
        .filter((r) => r.matchedCategory || r.manualCategoryId)
        .map((r) => ({
          category_name: r.header,
          category_id: r.manualCategoryId || r.matchedCategory?.id,
          amount: r.amount,
          people_count: r.peopleCount,
        }));

      const res = await fetch("/api/finance/outreach/budgets/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: teamId, rows: importRows }),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Import failed");
        return;
      }

      const { results } = json;
      toast.success(
        `Imported ${results.matched} budget${results.matched !== 1 ? "s" : ""}${
          results.unmatched.length > 0
            ? `. ${results.unmatched.length} unmatched.`
            : ""
        }`
      );
      setImported(true);
      router.refresh();
    } catch {
      toast.error("Network error during import");
    } finally {
      setLoading(false);
    }
  }

  const matchedCount = rows.filter(
    (r) => r.matchedCategory || r.manualCategoryId
  ).length;
  const unmatchedCount = rows.filter(
    (r) => !r.matchedCategory && !r.manualCategoryId
  ).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setRows([]);
          setImported(false);
          if (fileRef.current) fileRef.current.value = "";
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import Budget
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Budget from Spreadsheet</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Upload CSV or Excel file</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="mt-1 block w-full text-sm file:mr-4 file:py-2 file:px-4 file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Supports two formats: columns as category names (wide), or
              Category/Amount columns (long)
            </p>
          </div>

          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1 text-[color:var(--green-text)]">
                  <CheckCircle2 className="h-4 w-4" />
                  {matchedCount} matched
                </span>
                {unmatchedCount > 0 && (
                  <span className="flex items-center gap-1 text-amber">
                    <AlertTriangle className="h-4 w-4" />
                    {unmatchedCount} unmatched
                  </span>
                )}
              </div>

              <div className="border border-ink bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column Header</TableHead>
                      <TableHead>Matched Category</TableHead>
                      <TableHead className="text-right">Amount (ZAR)</TableHead>
                      <TableHead className="text-right">People</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => {
                      const isMatched = !!(
                        row.matchedCategory || row.manualCategoryId
                      );
                      return (
                        <TableRow
                          key={idx}
                          style={
                            !isMatched
                              ? {
                                  background: "hsl(42 80% 18%)",
                                  borderLeft: "2px solid var(--amber-border)",
                                }
                              : undefined
                          }
                        >
                          <TableCell className="font-medium">
                            {row.header}
                          </TableCell>
                          <TableCell>
                            {row.matchedCategory ? (
                              <span className="text-[color:var(--green-text)]">
                                {row.matchedCategory.name}
                              </span>
                            ) : (
                              <Select
                                value={row.manualCategoryId ?? ""}
                                onValueChange={(v) =>
                                  handleManualMatch(idx, v)
                                }
                              >
                                <SelectTrigger className="w-[180px]">
                                  <SelectValue placeholder="Select category..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {categories.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      {c.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {row.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.peopleCount ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setRows([]);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  Clear
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={loading || matchedCount === 0 || imported}
                >
                  {loading
                    ? "Importing..."
                    : imported
                      ? "Imported!"
                      : `Import ${matchedCount} Budget${matchedCount !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
