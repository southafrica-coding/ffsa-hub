"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bar } from "@/components/ffsa";
import { barTone } from "../../money-kpi";
import { lineTotal } from "@/lib/finance/outreach-budget";
import { CategoryPicker, type PickerCategory } from "./category-picker";
import { BudgetSheetImport } from "./budget-sheet-import";

export type BudgetLine = {
  id: string;
  team_id: string;
  category_id: string;
  description: string;
  amount_zar: number;
  frequency: number;
  uses_team_size: boolean;
  fixed_people: number;
  total_zar: number;
  sheet_total_zar: number | null;
  sort_order: number;
  source: "manual" | "import";
};

type Draft = {
  category_id: string;
  description: string;
  amount: string;
  frequency: string;
  uses_team_size: boolean;
  fixed_people: string;
};

const zar = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);
// Whole rands in the formula line — "R190 × 15 × 8" reads faster than cents.
const zarShort = (n: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
const num = (n: number) => String(Number(n));

function toDraft(l?: Partial<BudgetLine>, categoryId = ""): Draft {
  return {
    category_id: l?.category_id ?? categoryId,
    description: l?.description ?? "",
    amount: l?.amount_zar != null ? num(l.amount_zar) : "",
    frequency: l?.frequency != null ? num(l.frequency) : "1",
    uses_team_size: l?.uses_team_size ?? true,
    fixed_people: l?.fixed_people != null ? String(l.fixed_people) : "1",
  };
}

function draftLine(d: Draft) {
  return {
    amount_zar: Number(d.amount) || 0,
    frequency: d.frequency === "" ? 0 : Number(d.frequency) || 0,
    uses_team_size: d.uses_team_size,
    fixed_people: Number(d.fixed_people) || 0,
  };
}

/**
 * The outreach budget as the team works with it day to day: how many
 * people, every line as "amount × times × people", and per category
 * what was planned, what has been spent and what is left.
 */
export function BudgetLines({
  teamId,
  teamSize: initialTeamSize,
  lines: initialLines,
  categories: initialCategories,
  spentByCategory,
  canEdit,
}: {
  teamId: string;
  teamSize: number;
  lines: BudgetLine[];
  categories: PickerCategory[];
  spentByCategory: Record<string, number>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const [categories, setCategories] = useState(initialCategories);
  const [teamSize, setTeamSize] = useState(initialTeamSize);
  const [editingId, setEditingId] = useState<string | null>(null);
  // "top" = the general add row, otherwise a category id
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setLines(initialLines), [initialLines]);
  useEffect(() => setCategories(initialCategories), [initialCategories]);
  useEffect(() => setTeamSize(initialTeamSize), [initialTeamSize]);

  // ── Team size: move the numbers now, save shortly after the last click.
  const sizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function changeTeamSize(next: number) {
    const size = Math.max(0, Math.min(1000, Math.round(next)));
    setTeamSize(size);
    if (sizeTimer.current) clearTimeout(sizeTimer.current);
    sizeTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/finance/outreach/team-size", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_id: teamId, size }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error || "Couldn't save the team size");
          setTeamSize(initialTeamSize);
          return;
        }
        router.refresh();
      } catch {
        toast.error("Network error — team size not saved");
        setTeamSize(initialTeamSize);
      }
    }, 600);
  }

  const totalOf = (l: BudgetLine) => lineTotal(l, teamSize);
  const grandTotal = lines.reduce((s, l) => s + totalOf(l), 0);
  const followers = lines.filter((l) => l.uses_team_size).length;

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // One group per category that has lines OR has spending against it.
  const groups = useMemo(() => {
    const ids = new Set<string>([
      ...lines.map((l) => l.category_id),
      ...Object.keys(spentByCategory).filter((id) => spentByCategory[id] > 0),
    ]);
    return [...ids]
      .map((id) => ({
        category: catById.get(id) ?? { id, name: "Unknown category", slug: "", sort_order: 9999 },
        lines: lines.filter((l) => l.category_id === id).sort((a, b) => a.sort_order - b.sort_order),
      }))
      .sort((a, b) => a.category.sort_order - b.category.sort_order || a.category.name.localeCompare(b.category.name));
  }, [lines, spentByCategory, catById]);

  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);

  // ── Writes
  async function saveLine(id: string | null, d: Draft) {
    if (!d.description.trim()) return toast.error("Say what the line is for");
    if (!d.category_id) return toast.error("Pick a category");
    setBusy(true);
    try {
      const body = {
        ...(id ? { id } : { team_id: teamId }),
        category_id: d.category_id,
        description: d.description.trim(),
        ...draftLine(d),
      };
      const res = await fetch("/api/finance/outreach/budget-lines", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          id ? body : { ...body, sort_order: lines.length ? Math.max(...lines.map((l) => l.sort_order)) + 1 : 0 }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Couldn't save that line");
        return;
      }
      setLines((prev) =>
        id ? prev.map((l) => (l.id === id ? { ...l, ...data.line } : l)) : [...prev, data.line]
      );
      setEditingId(null);
      setAddingIn(null);
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteLine(l: BudgetLine) {
    if (!confirm(`Remove "${l.description}" (${zar(totalOf(l))}) from the budget?`)) return;
    const before = lines;
    setLines((prev) => prev.filter((x) => x.id !== l.id));
    try {
      const res = await fetch(`/api/finance/outreach/budget-lines?id=${l.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Couldn't remove that line");
        setLines(before);
        return;
      }
      router.refresh();
    } catch {
      toast.error("Network error");
      setLines(before);
    }
  }

  const addCategory = (c: PickerCategory) =>
    setCategories((prev) => (prev.some((p) => p.id === c.id) ? prev : [...prev, c]));

  const importedCount = lines.filter((l) => l.source === "import").length;

  return (
    <div className="space-y-5">
      {/* ── Team size: the number every per-person line hangs off ── */}
      <div className="flex flex-col gap-4 border border-ink bg-bone px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mono-label mb-2">People on this team</div>
          <div className="flex items-center gap-3">
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                aria-label="One fewer person"
                onClick={() => changeTeamSize(teamSize - 1)}
                disabled={teamSize <= 0}
              >
                <Minus className="h-4 w-4" />
              </Button>
            )}
            {canEdit ? (
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                aria-label="People on this team"
                value={teamSize}
                onChange={(e) => changeTeamSize(Number(e.target.value))}
                className="numeral h-12 w-20 text-center text-[32px]"
              />
            ) : (
              <span className="numeral text-[40px] leading-none">{teamSize}</span>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                aria-label="One more person"
                onClick={() => changeTeamSize(teamSize + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="sm:text-right">
          <div className="mono-label mb-1">Budget</div>
          <div className="numeral text-[30px] leading-none">{zar(grandTotal)}</div>
          <div className="mt-1.5 font-mono text-[11px] text-[#55524A]">
            {teamSize > 0 && `${zar(grandTotal / teamSize)} per person · `}
            {followers === 0
              ? "no lines follow the team size"
              : `${followers} ${followers === 1 ? "line follows" : "lines follow"} the team size`}
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Budget lines</h3>
        {canEdit && (
          <div className="flex gap-2">
            <BudgetSheetImport
              teamId={teamId}
              teamSize={teamSize}
              categories={categories}
              importedCount={importedCount}
              onCategoryCreated={addCategory}
            />
            <Button size="sm" onClick={() => setAddingIn("top")} disabled={addingIn === "top"}>
              <Plus className="mr-1.5 h-4 w-4" /> Add line
            </Button>
          </div>
        )}
      </div>

      {addingIn === "top" && (
        <div className="border border-ink">
          <LineEditor
            initial={toDraft()}
            teamSize={teamSize}
            categories={categories}
            showCategory
            busy={busy}
            onCategoryCreated={addCategory}
            onSave={(d) => saveLine(null, d)}
            onCancel={() => setAddingIn(null)}
          />
        </div>
      )}

      {groups.length === 0 && addingIn !== "top" && (
        <div className="border border-dashed border-rule-strong px-6 py-10 text-center">
          <p className="font-medium">No budget yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {canEdit
              ? "Import the budget sheet, or add lines one at a time."
              : "Your finance lead hasn't set up this team's budget yet."}
          </p>
        </div>
      )}

      {/* ── One block per category ── */}
      {groups.map(({ category, lines: catLines }) => {
        const planned = catLines.reduce((s, l) => s + totalOf(l), 0);
        const spent = spentByCategory[category.id] ?? 0;
        const left = planned - spent;
        const pct = planned > 0 ? (spent / planned) * 100 : spent > 0 ? 101 : 0;
        return (
          <section key={category.id} className="border border-ink">
            <header className="bg-bone px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h4 className="font-medium">{category.name}</h4>
                <div className="flex gap-4 font-mono text-[12px] tabular-nums">
                  <span>
                    <span className="text-[#7C786C]">Planned </span>
                    {zar(planned)}
                  </span>
                  <span>
                    <span className="text-[#7C786C]">Spent </span>
                    {zar(spent)}
                  </span>
                  <span className={left < 0 ? "text-destructive font-bold" : "text-grass-text"}>
                    <span className="text-[#7C786C] font-normal">Left </span>
                    {zar(left)}
                  </span>
                </div>
              </div>
              <div className="mt-2.5">
                <Bar pct={pct} tone={barTone(pct)} />
              </div>
            </header>

            {catLines.length === 0 && (
              <p className="border-t border-rule px-4 py-3 text-sm text-muted-foreground">
                Money has been spent here but nothing was planned for it.
              </p>
            )}

            {catLines.map((l) =>
              editingId === l.id ? (
                <div key={l.id} className="border-t border-rule">
                  <LineEditor
                    initial={toDraft(l)}
                    teamSize={teamSize}
                    categories={categories}
                    showCategory
                    busy={busy}
                    onCategoryCreated={addCategory}
                    onSave={(d) => saveLine(l.id, d)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <LineRow
                  key={l.id}
                  line={l}
                  teamSize={teamSize}
                  total={totalOf(l)}
                  canEdit={canEdit}
                  onEdit={() => {
                    setAddingIn(null);
                    setEditingId(l.id);
                  }}
                  onDelete={() => deleteLine(l)}
                />
              )
            )}

            {canEdit &&
              (addingIn === category.id ? (
                <div className="border-t border-rule">
                  <LineEditor
                    initial={toDraft(undefined, category.id)}
                    teamSize={teamSize}
                    categories={categories}
                    showCategory={false}
                    busy={busy}
                    onCategoryCreated={addCategory}
                    onSave={(d) => saveLine(null, d)}
                    onCancel={() => setAddingIn(null)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setAddingIn(category.id);
                  }}
                  className="block w-full border-t border-rule px-4 py-2 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-[#7C786C] hover:bg-bone hover:text-ink"
                >
                  + Add a line to {category.name}
                </button>
              ))}
          </section>
        );
      })}

      {groups.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-y-2 border-ink px-4 py-3">
          <span className="font-medium">Whole budget</span>
          <div className="flex gap-4 font-mono text-[13px] font-bold tabular-nums">
            <span>
              <span className="font-normal text-[#7C786C]">Planned </span>
              {zar(grandTotal)}
            </span>
            <span>
              <span className="font-normal text-[#7C786C]">Spent </span>
              {zar(totalSpent)}
            </span>
            <span className={grandTotal - totalSpent < 0 ? "text-destructive" : "text-grass-text"}>
              <span className="font-normal text-[#7C786C]">Left </span>
              {zar(grandTotal - totalSpent)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// ONE LINE, READ MODE
// ────────────────────────────────────────────────────────────

function LineRow({
  line,
  teamSize,
  total,
  canEdit,
  onEdit,
  onDelete,
}: {
  line: BudgetLine;
  teamSize: number;
  total: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const people = line.uses_team_size ? teamSize : line.fixed_people;
  const unpriced = Number(line.amount_zar) === 0;
  return (
    <div className="group flex items-start gap-3 border-t border-rule px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{line.description}</div>
        <div className="mt-0.5 font-mono text-[11px] text-[#55524A]">
          {unpriced ? (
            <span className="text-amber">Not priced yet</span>
          ) : (
            <>
              {zarShort(Number(line.amount_zar))} × {num(line.frequency)} × {people}{" "}
              {people === 1 ? "person" : "people"}
              {line.uses_team_size && <span className="text-[#7C786C]"> (whole team)</span>}
            </>
          )}
        </div>
      </div>
      <div className="pt-px text-right font-mono text-sm tabular-nums">{zar(total)}</div>
      {canEdit && (
        <div className="flex shrink-0 gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label={`Edit ${line.description}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={`Remove ${line.description}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// ONE LINE, EDIT MODE (also used to add)
// ────────────────────────────────────────────────────────────

function LineEditor({
  initial,
  teamSize,
  categories,
  showCategory,
  busy,
  onSave,
  onCancel,
  onCategoryCreated,
}: {
  initial: Draft;
  teamSize: number;
  categories: PickerCategory[];
  showCategory: boolean;
  busy: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
  onCategoryCreated: (c: PickerCategory) => void;
}) {
  const [d, setD] = useState(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const total = lineTotal(draftLine(d), teamSize);

  return (
    <form
      className="space-y-3 bg-[#FBFAF6] px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className={`grid gap-3 ${showCategory ? "sm:grid-cols-[2fr_1fr]" : ""}`}>
        <Field label="What is it for?">
          <Input
            autoFocus
            value={d.description}
            onChange={(e) => set("description", e.target.value)}
            aria-label="What is it for?"
            placeholder="e.g. Destination A – Food"
            className="h-9"
          />
        </Field>
        {showCategory && (
          <Field label="Category">
            <CategoryPicker
              categories={categories}
              value={d.category_id}
              onChange={(v) => set("category_id", v)}
              onCreated={onCategoryCreated}
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1.6fr_auto_1fr]">
        <Field label="Amount (R)">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            aria-label="Amount in rand"
            value={d.amount}
            onChange={(e) => set("amount", e.target.value)}
            placeholder="0"
            className="h-9 text-right font-mono"
          />
        </Field>
        <Times />
        <Field label="How many times">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            aria-label="How many times"
            value={d.frequency}
            onChange={(e) => set("frequency", e.target.value)}
            className="h-9 text-right font-mono"
          />
        </Field>
        <Times />
        <Field label="People">
          <div className="flex gap-1.5">
            <Select
              value={d.uses_team_size ? "team" : "fixed"}
              onValueChange={(v) => set("uses_team_size", v === "team")}
            >
              <SelectTrigger className="h-9 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Whole team ({teamSize})</SelectItem>
                <SelectItem value="fixed">A set number</SelectItem>
              </SelectContent>
            </Select>
            {!d.uses_team_size && (
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                aria-label="Number of people"
                value={d.fixed_people}
                onChange={(e) => set("fixed_people", e.target.value)}
                className="h-9 w-16 text-right font-mono"
              />
            )}
          </div>
        </Field>
        <span className="hidden pb-2 font-mono text-[#7C786C] sm:block">=</span>
        <Field label="Total">
          <div className="flex h-9 items-center justify-end font-mono font-bold tabular-nums">{zar(total)}</div>
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving…" : "Save line"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // A div, not a <label>: a label wrapping a Radix Select re-opens it on
    // every click. The inputs carry their own aria-labels instead.
    <div className="block min-w-0">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-[#55524A]">{label}</span>
      {children}
    </div>
  );
}

function Times() {
  return <span className="hidden pb-2 font-mono text-[#7C786C] sm:block">×</span>;
}
