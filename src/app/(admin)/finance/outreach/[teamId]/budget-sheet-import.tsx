"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { guessCategory, lineTotal, parseBudgetSheet } from "@/lib/finance/outreach-budget";
import { CategoryPicker, type PickerCategory } from "./category-picker";

type Row = {
  key: number;
  include: boolean;
  description: string;
  category_id: string;
  guessed: boolean;
  amount_zar: number;
  frequency: number;
  uses_team_size: boolean;
  fixed_people: number;
  sheet_people: number | null;
  sheet_total_zar: number | null;
};

const zar = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

/**
 * Import the finance team's budget sheet (CSV or Excel) exactly as they
 * keep it. Every line comes through to a preview where the category can
 * be checked and the team size confirmed before anything is saved.
 */
export function BudgetSheetImport({
  teamId,
  teamSize,
  categories,
  importedCount,
  onCategoryCreated,
}: {
  teamId: string;
  teamSize: number;
  categories: PickerCategory[];
  importedCount: number;
  onCategoryCreated: (c: PickerCategory) => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [size, setSize] = useState(teamSize);
  const [sheetSize, setSheetSize] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setRows([]);
    setFilename("");
    setSheetSize(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      let parsed: ReturnType<typeof parseBudgetSheet> = null;
      for (const name of wb.SheetNames) {
        const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
          header: 1,
          raw: true,
          defval: "",
        });
        parsed = parseBudgetSheet(raw);
        if (parsed && parsed.lines.length) break;
      }
      if (!parsed || parsed.lines.length === 0) {
        toast.error(
          "Couldn't find the budget in that file. It needs a header row with Amount, Frequency, People and Total."
        );
        reset();
        return;
      }

      const fromSheet = parsed.likelyTeamSize;
      const chosen = teamSize > 0 ? teamSize : fromSheet ?? 0;
      setSheetSize(fromSheet);
      setSize(chosen);
      setFilename(file.name);
      setRows(
        parsed.lines.map((l, i) => {
          const cat = guessCategory(l.description, categories);
          // A line whose People matches the sheet's usual head-count (or is
          // blank) follows the team size; anything else — "2 leaders" — is
          // kept as a set number.
          const follows = l.people === null || (fromSheet !== null && l.people === fromSheet);
          return {
            key: i,
            include: true,
            description: l.description,
            category_id: cat?.id ?? "",
            guessed: Boolean(cat),
            amount_zar: l.amount_zar,
            frequency: l.frequency,
            uses_team_size: follows,
            fixed_people: follows ? 1 : l.people ?? 1,
            sheet_people: l.people,
            sheet_total_zar: l.sheet_total_zar,
          };
        })
      );
    } catch {
      toast.error("Couldn't read that file. Save it as .csv or .xlsx and try again.");
      reset();
    }
  }

  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const included = rows.filter((r) => r.include);
  const missingCategory = included.filter((r) => !r.category_id).length;
  const total = included.reduce((s, r) => s + lineTotal(r, size), 0);

  // Does the sheet's own Total agree with Amount × Frequency × People?
  function mismatch(r: Row) {
    if (r.sheet_total_zar === null) return false;
    const people = r.sheet_people ?? (r.uses_team_size ? size : r.fixed_people);
    return Math.abs(r.amount_zar * r.frequency * people - r.sheet_total_zar) > 0.5;
  }

  async function save() {
    if (missingCategory > 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/finance/outreach/budget-lines/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: teamId,
          filename,
          team_size: size !== teamSize ? size : null,
          lines: included.map((r) => ({
            category_id: r.category_id,
            description: r.description,
            amount_zar: r.amount_zar,
            frequency: r.frequency,
            uses_team_size: r.uses_team_size,
            fixed_people: r.fixed_people,
            sheet_total_zar: r.sheet_total_zar,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Import failed");
        return;
      }
      toast.success(`Imported ${included.length} lines — budget is now ${zar(total)}`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      toast.error("Network error — nothing was imported");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="mr-1.5 h-4 w-4" /> Import budget sheet
      </Button>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import budget sheet</DialogTitle>
          <DialogDescription>
            Upload the budget as a CSV or Excel file with Amount, Frequency, People and Total
            columns. You&apos;ll check every line before anything is saved.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
            className="flex w-full flex-col items-center gap-2 border border-dashed border-rule-strong px-6 py-12 text-center hover:bg-bone"
          >
            <Upload className="h-6 w-6 text-[#7C786C]" />
            <span className="font-medium">Choose a file or drop it here</span>
            <span className="text-sm text-muted-foreground">.csv, .xlsx or .xls</span>
          </button>
        ) : (
          <div className="space-y-4">
            {importedCount > 0 && (
              <div className="flex gap-2 border border-amber-border bg-[#FFF8E6] px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                <span>
                  This replaces the {importedCount} {importedCount === 1 ? "line" : "lines"} from the last
                  import. Lines added by hand stay as they are.
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-ink bg-bone px-4 py-3">
              <span className="text-sm font-medium">People on this team</span>
              <Input
                type="number"
                min={0}
                aria-label="People on this team"
                value={size}
                onChange={(e) => setSize(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                className="h-9 w-20 text-center font-mono"
              />
              {sheetSize !== null && sheetSize !== size && (
                <span className="text-sm text-muted-foreground">
                  The sheet is worked out for {sheetSize}.{" "}
                  <button type="button" className="underline" onClick={() => setSize(sheetSize)}>
                    Use {sheetSize}
                  </button>
                </span>
              )}
              <span className="ml-auto font-mono text-sm">
                <span className="text-[#7C786C]">from </span>
                {filename}
              </span>
            </div>

            <div className="overflow-x-auto border border-ink">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-bone font-mono text-[10px] uppercase tracking-[0.1em] text-[#55524A]">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-2 py-2 text-left">Line</th>
                    <th className="w-[220px] px-2 py-2 text-left">Category</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2 text-right">Times</th>
                    <th className="w-[180px] px-2 py-2 text-left">People</th>
                    <th className="px-2 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const t = lineTotal(r, size);
                    const off = mismatch(r);
                    return (
                      <tr key={r.key} className={`border-t border-rule ${r.include ? "" : "opacity-40"}`}>
                        <td className="px-2 py-1.5 text-center">
                          <Checkbox
                            checked={r.include}
                            aria-label={`Include ${r.description}`}
                            onCheckedChange={(v) => update(r.key, { include: v === true })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.description}
                            aria-label="Line description"
                            onChange={(e) => update(r.key, { description: e.target.value })}
                            className="h-8 min-w-[200px] border-transparent bg-transparent px-1 shadow-none hover:border-rule focus:border-rule-strong"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <CategoryPicker
                            categories={categories}
                            value={r.category_id}
                            onChange={(v) => update(r.key, { category_id: v, guessed: false })}
                            onCreated={onCategoryCreated}
                            placeholder="Choose…"
                            className={!r.category_id && r.include ? "border-destructive" : ""}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {r.amount_zar === 0 ? <span className="text-amber">—</span> : zar(r.amount_zar)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">{String(r.frequency)}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <Select
                              value={r.uses_team_size ? "team" : "fixed"}
                              onValueChange={(v) => update(r.key, { uses_team_size: v === "team" })}
                            >
                              <SelectTrigger className="h-8 min-w-0 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="team">Team ({size})</SelectItem>
                                <SelectItem value="fixed">Set no.</SelectItem>
                              </SelectContent>
                            </Select>
                            {!r.uses_team_size && (
                              <Input
                                type="number"
                                min={0}
                                aria-label="Number of people"
                                value={r.fixed_people}
                                onChange={(e) =>
                                  update(r.key, { fixed_people: Math.max(0, Math.round(Number(e.target.value) || 0)) })
                                }
                                className="h-8 w-14 text-right font-mono"
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {zar(t)}
                          {off && (
                            <div
                              className="text-[10px] text-amber"
                              title="The sheet's Total column doesn't equal Amount × Frequency × People"
                            >
                              sheet says {zar(r.sheet_total_zar ?? 0)}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium">{included.length} lines</span>
                <span className="text-muted-foreground"> · budget </span>
                <span className="font-mono font-bold">{zar(total)}</span>
                {missingCategory > 0 && (
                  <span className="ml-2 text-destructive">
                    · {missingCategory} {missingCategory === 1 ? "line needs" : "lines need"} a category
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={reset}>
                  Choose another file
                </Button>
                <Button onClick={save} disabled={saving || included.length === 0 || missingCategory > 0}>
                  {saving ? "Importing…" : `Import ${included.length} lines`}
                </Button>
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
