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

type ParsedExpense = {
  receiptCode: string | null;
  date: string; // YYYY-MM-DD
  vendor: string | null;
  description: string | null;
  categoryName: string;
  purchaser: string | null;
  zarAmount: number;
  receiptTurnedIn: string | null;
  notes: string | null;
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

function parseCurrency(value: unknown): number {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "")
    .replace(/[R$€£\s]/g, "")
    .replace(/,/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Parse DD/MM/YYYY → YYYY-MM-DD
function parseDate(value: unknown): string | null {
  const str = String(value ?? "").trim();
  if (!str) return null;

  // DD/MM/YYYY
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // Excel serial number
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value as number);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
    }
  }

  return null;
}

function matchCategory(name: string, categories: Category[]): Category | null {
  const lower = name.toLowerCase().trim();
  const slug = slugify(name);
  for (const cat of categories) {
    if (cat.name.toLowerCase() === lower) return cat;
  }
  for (const cat of categories) {
    if (cat.slug === slug) return cat;
  }
  for (const cat of categories) {
    const catLower = cat.name.toLowerCase();
    if (lower.includes(catLower) || catLower.includes(lower)) return cat;
  }
  return null;
}

function parseExpenseSheet(
  rawRows: unknown[][],
  categories: Category[]
): ParsedExpense[] | null {
  // Find the header row that contains "Date", "Vendor", "Category"
  let headerRowIdx = -1;
  for (let i = 0; i < rawRows.length; i++) {
    const cells = (rawRows[i] as unknown[]).map((c) =>
      String(c ?? "").toLowerCase().trim()
    );
    if (
      cells.some((c) => c === "date") &&
      cells.some((c) => c.includes("vendor") || c.includes("purchase")) &&
      cells.some((c) => c.includes("category"))
    ) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) return null;

  // Determine column indices dynamically from the header row
  const headerCells = (rawRows[headerRowIdx] as unknown[]).map((c) =>
    String(c ?? "").toLowerCase().trim()
  );

  const colIdx = {
    receiptCode: headerCells.findIndex((c) => c.includes("receipt code")),
    date: headerCells.findIndex((c) => c === "date"),
    vendor: headerCells.findIndex((c) => c === "vendor"),
    description: headerCells.findIndex(
      (c) => c.includes("purchase") || c.includes("what was bought")
    ),
    category: headerCells.findIndex((c) => c.includes("category")),
    purchaser: headerCells.findIndex((c) => c.includes("purchaser") || c.includes("purchas")),
    zarAmount: headerCells.findIndex(
      (c) => c.includes("amount (r)") || c.includes("amount(r)")
    ),
    receipt: headerCells.findIndex(
      (c) => c.includes("receipt?") || c === "receipt"
    ),
    notes: headerCells.findIndex((c) => c === "notes"),
  };

  // Fallback to positional columns based on FFSA format if dynamic detection fails
  // Col indices: [0-empty, 1-empty, 2-label, 3-receiptCode, 4-date, 5-vendor, 6-desc, 7-category, 8-purchaser, 9-localAmt, 10-exchRate, 11-zarAmt, 12-receipt, 13-notes]
  if (colIdx.date === -1) colIdx.date = 4;
  if (colIdx.vendor === -1) colIdx.vendor = 5;
  if (colIdx.description === -1) colIdx.description = 6;
  if (colIdx.category === -1) colIdx.category = 7;
  if (colIdx.purchaser === -1) colIdx.purchaser = 8;
  if (colIdx.zarAmount === -1) colIdx.zarAmount = 11;
  if (colIdx.receiptCode === -1) colIdx.receiptCode = 3;
  if (colIdx.receipt === -1) colIdx.receipt = 12;
  if (colIdx.notes === -1) colIdx.notes = 13;

  const results: ParsedExpense[] = [];

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const dateVal = parseDate(row[colIdx.date]);
    const zarAmount = parseCurrency(row[colIdx.zarAmount]);
    const categoryName = String(row[colIdx.category] ?? "").trim();

    if (!dateVal || zarAmount <= 0 || !categoryName) continue;
    // Skip "total" rows
    if (categoryName.toLowerCase() === "total") continue;

    results.push({
      receiptCode: String(row[colIdx.receiptCode] ?? "").trim() || null,
      date: dateVal,
      vendor: String(row[colIdx.vendor] ?? "").trim() || null,
      description: String(row[colIdx.description] ?? "").trim() || null,
      categoryName,
      purchaser: String(row[colIdx.purchaser] ?? "").trim() || null,
      zarAmount,
      receiptTurnedIn: String(row[colIdx.receipt] ?? "").trim() || null,
      notes: String(row[colIdx.notes] ?? "").trim() || null,
      matchedCategory: matchCategory(categoryName, categories),
      manualCategoryId: null,
    });
  }

  return results.length > 0 ? results : null;
}

export function ExpenseImport({
  teamId,
  categories,
}: {
  teamId: string;
  categories: Category[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [imported, setImported] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });

        // Try each sheet until one parses successfully
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            defval: "",
          });
          const parsed = parseExpenseSheet(rawRows, categories);
          if (parsed && parsed.length > 0) {
            setRows(parsed);
            setImported(false);
            return;
          }
        }

        toast.error("No valid expense data found. Make sure you're uploading the Expense Tracker sheet.");
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
    const importable = rows.filter(
      (r) => r.matchedCategory || r.manualCategoryId
    );
    let succeeded = 0;
    let failed = 0;

    try {
      for (const row of importable) {
        const categoryId = row.manualCategoryId || row.matchedCategory?.id;
        const res = await fetch("/api/finance/outreach/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            team_id: teamId,
            category_id: categoryId,
            expense_date: row.date,
            receipt_code: row.receiptCode,
            vendor: row.vendor,
            // description is NOT NULL in DB — fall back to category name
            description: row.description || row.categoryName,
            purchaser: row.purchaser,
            payment_method: "card",
            // local_amount is NOT NULL in DB — use ZAR amount for ZAR-only entries
            local_currency: "ZAR",
            local_amount: row.zarAmount,
            zar_amount: row.zarAmount,
            exchange_rate: 1,
            notes: row.notes,
          }),
        });

        if (res.ok) {
          succeeded++;
        } else {
          failed++;
        }
      }

      if (succeeded > 0) {
        toast.success(
          `Imported ${succeeded} expense${succeeded !== 1 ? "s" : ""}${failed > 0 ? `. ${failed} failed.` : ""}`
        );
        setImported(true);
        router.refresh();
      } else {
        toast.error("All imports failed");
      }
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
          Import Expenses
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Expenses from Spreadsheet</DialogTitle>
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
              Upload the FFSA Expense Tracker sheet (CSV or Excel)
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
                    {unmatchedCount} unmatched — assign a category below
                  </span>
                )}
              </div>

              <div className="overflow-x-auto border border-ink">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Purchaser</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">ZAR</TableHead>
                      <TableHead>Receipt?</TableHead>
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
                          <TableCell className="whitespace-nowrap text-sm">
                            {row.date}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.vendor ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm max-w-[160px] truncate">
                            {row.description ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.purchaser ?? "—"}
                          </TableCell>
                          <TableCell>
                            {row.matchedCategory ? (
                              <span className="text-[color:var(--green-text)] text-sm">
                                {row.matchedCategory.name}
                              </span>
                            ) : (
                              <Select
                                value={row.manualCategoryId ?? ""}
                                onValueChange={(v) =>
                                  handleManualMatch(idx, v)
                                }
                              >
                                <SelectTrigger className="w-[160px]">
                                  <SelectValue placeholder="Select..." />
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
                          <TableCell className="text-right font-mono text-sm">
                            {row.zarAmount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.receiptTurnedIn ?? "—"}
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
                      : `Import ${matchedCount} Expense${matchedCount !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
