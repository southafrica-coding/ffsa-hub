"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Trash2, Edit2, Loader2, Upload, X } from "lucide-react";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { ReceiptGallery } from "./receipt-gallery";
import { createClient } from "@/lib/supabase/client";
import { ExpenseImport } from "./expense-import";

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

type Expense = {
  id: string;
  team_id: string;
  category_id: string;
  expense_date: string;
  receipt_code: string | null;
  vendor: string | null;
  description: string | null;
  purchaser: string | null;
  payment_method: string;
  country: string | null;
  local_currency: string | null;
  local_amount: number | null;
  zar_amount: number;
  exchange_rate: number | null;
  cash_batch_id: string | null;
  receipt_path: string | null;
  notes: string | null;
  outreach_budget_categories: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

type Category = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
};

type CashBatch = {
  id: string;
  batch_date: string;
  zar_withdrawn: number;
  local_currency: string | null;
  exchange_rate: number | null;
};

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "reimbursement", label: "Reimbursement" },
  { value: "prepayment", label: "Prepayment" },
];

// ────────────────────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────────────────────

export function ExpensesTab({
  teamId,
  expenses,
  categories,
  cashBatches,
  receiptCounts = {},
  readOnly = false,
}: {
  teamId: string;
  expenses: Expense[];
  categories: Category[];
  cashBatches: CashBatch[];
  receiptCounts?: Record<string, number>;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingRate, setFetchingRate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);

  // Form state
  const emptyForm = {
    category_id: "",
    expense_date: "",
    receipt_code: "",
    vendor: "",
    description: "",
    purchaser: "",
    payment_method: "cash",
    country: "",
    local_currency: "",
    local_amount: "",
    zar_amount: "",
    exchange_rate: "",
    cash_batch_id: "",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  function updateField(field: string, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-calculate exchange rate
      if (
        (field === "local_amount" || field === "zar_amount") &&
        next.local_amount &&
        next.zar_amount &&
        Number(next.zar_amount) > 0
      ) {
        next.exchange_rate = (
          Number(next.local_amount) / Number(next.zar_amount)
        ).toFixed(6);
      }
      // Pre-fill exchange rate from cash batch
      if (field === "cash_batch_id" && value) {
        const batch = cashBatches.find((b) => b.id === value);
        if (batch?.exchange_rate) {
          next.exchange_rate = String(batch.exchange_rate);
          if (batch.local_currency) {
            next.local_currency = batch.local_currency;
          }
        }
      }
      return next;
    });
  }

  async function fetchExchangeRate() {
    const currency = form.local_currency;
    if (!currency || currency === "ZAR") return;
    setFetchingRate(true);
    try {
      const res = await fetch(
        `/api/finance/outreach/exchange-rate?from=${currency}&to=ZAR`
      );
      if (!res.ok) {
        toast.error("Failed to fetch exchange rate");
        return;
      }
      const { rate } = await res.json();
      // rate = 1 unit of LOCAL = X ZAR
      // But our exchange_rate field = local_amount / zar_amount
      // So exchange_rate = 1 / rate
      const exchangeRate = 1 / rate;
      setForm((prev) => {
        const next = { ...prev, exchange_rate: exchangeRate.toFixed(6) };
        // Auto-calculate ZAR if local amount is filled
        if (next.local_amount && Number(next.local_amount) > 0) {
          next.zar_amount = (
            Number(next.local_amount) / exchangeRate
          ).toFixed(2);
        }
        return next;
      });
      toast.success(`Rate fetched: 1 ${currency} = ${rate.toFixed(6)} ZAR`);
    } catch {
      toast.error("Exchange rate service unavailable");
    } finally {
      setFetchingRate(false);
    }
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);

  const totalSpent = expenses.reduce(
    (sum, e) => sum + Number(e.zar_amount),
    0
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = {
        team_id: teamId,
        category_id: form.category_id,
        expense_date: form.expense_date,
        receipt_code: form.receipt_code || null,
        vendor: form.vendor || null,
        description: form.description || null,
        purchaser: form.purchaser || null,
        payment_method: form.payment_method,
        country: form.country || null,
        local_currency: form.local_currency || null,
        local_amount: form.local_amount ? Number(form.local_amount) : null,
        zar_amount: Number(form.zar_amount),
        exchange_rate: form.exchange_rate ? Number(form.exchange_rate) : null,
        cash_batch_id: form.cash_batch_id || null,
        notes: form.notes || null,
      };

      const url = "/api/finance/outreach/expenses";
      const method = editingId ? "PUT" : "POST";
      const body = editingId ? { id: editingId, ...payload } : payload;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save expense");
        return;
      }

      // Upload receipt files if any are attached
      const result = await res.json();
      const expenseId = editingId || result.data?.id;

      if (receiptFiles.length > 0 && expenseId) {
        const supabase = createClient();
        for (const file of receiptFiles) {
          const filePath = `${teamId}/${expenseId}/${Date.now()}_${file.name}`;
          const { error: uploadError } = await supabase.storage
            .from("outreach-receipts")
            .upload(filePath, file, { upsert: true });

          if (uploadError) {
            toast.error(`Receipt upload failed: ${file.name}`);
            continue;
          }

          await fetch("/api/finance/outreach/receipts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expense_id: expenseId,
              file_path: filePath,
              file_name: file.name,
              file_size: file.size,
              mime_type: file.type,
            }),
          });
        }
      }

      setAddOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      setReceiptFiles([]);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this expense?")) return;
    try {
      const res = await fetch(`/api/finance/outreach/expenses?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } catch {
      toast.error("Failed to delete expense");
    }
  }

  function openEdit(expense: Expense) {
    setEditingId(expense.id);
    setForm({
      category_id: expense.category_id,
      expense_date: expense.expense_date,
      receipt_code: expense.receipt_code ?? "",
      vendor: expense.vendor ?? "",
      description: expense.description ?? "",
      purchaser: expense.purchaser ?? "",
      payment_method: expense.payment_method,
      country: expense.country ?? "",
      local_currency: expense.local_currency ?? "",
      local_amount: expense.local_amount != null ? String(expense.local_amount) : "",
      zar_amount: String(expense.zar_amount),
      exchange_rate: expense.exchange_rate != null ? String(expense.exchange_rate) : "",
      cash_batch_id: expense.cash_batch_id ?? "",
      notes: expense.notes ?? "",
    });
    setAddOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">
          Expenses{" "}
          <span className="text-muted-foreground font-normal">
            ({expenses.length})
          </span>
        </h3>
        <Dialog
          open={addOpen}
          onOpenChange={(v) => {
            setAddOpen(v);
            if (!v) {
              setEditingId(null);
              setForm(emptyForm);
              setReceiptFiles([]);
              setError(null);
            }
          }}
        >
          {!readOnly && (
            <div className="flex gap-2">
              <ExpenseImport teamId={teamId} categories={categories} />
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Expense
                </Button>
              </DialogTrigger>
            </div>
          )}
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Expense" : "Add Expense"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Category *</Label>
                  <Select
                    value={form.category_id}
                    onValueChange={(v) => updateField("category_id", v)}
                  >
                    <SelectTrigger>
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
                </div>
                <div>
                  <Label>Expense Date *</Label>
                  <DateInput
                    required
                    value={form.expense_date}
                    onChange={(v) => updateField("expense_date", v)}
                  />
                </div>
                <div>
                  <Label>Receipt Code</Label>
                  <Input
                    value={form.receipt_code}
                    onChange={(e) => updateField("receipt_code", e.target.value)}
                    placeholder="e.g. R001"
                  />
                </div>
                <div>
                  <Label>Vendor</Label>
                  <Input
                    value={form.vendor}
                    onChange={(e) => updateField("vendor", e.target.value)}
                    placeholder="e.g. Local Market"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Description</Label>
                  <Input
                    value={form.description}
                    onChange={(e) =>
                      updateField("description", e.target.value)
                    }
                    placeholder="What was purchased?"
                  />
                </div>
                <div>
                  <Label>Purchaser</Label>
                  <Input
                    value={form.purchaser}
                    onChange={(e) => updateField("purchaser", e.target.value)}
                    placeholder="Who bought it?"
                  />
                </div>
                <div>
                  <Label>Payment Method</Label>
                  <Select
                    value={form.payment_method}
                    onValueChange={(v) => updateField("payment_method", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Country</Label>
                  <Input
                    value={form.country}
                    onChange={(e) => updateField("country", e.target.value)}
                    placeholder="e.g. Burundi"
                  />
                </div>
                <div>
                  <Label>Local Currency</Label>
                  <Select
                    value={form.local_currency || "none"}
                    onValueChange={(v) =>
                      updateField("local_currency", v === "none" ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select currency..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Local Amount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.local_amount}
                    onChange={(e) =>
                      updateField("local_amount", e.target.value)
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label>ZAR Amount *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.zar_amount}
                    onChange={(e) => updateField("zar_amount", e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label>Exchange Rate</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.000001"
                      value={form.exchange_rate}
                      onChange={(e) =>
                        updateField("exchange_rate", e.target.value)
                      }
                      placeholder="Auto-calculated"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={
                        !form.local_currency ||
                        form.local_currency === "ZAR" ||
                        fetchingRate
                      }
                      onClick={fetchExchangeRate}
                    >
                      {fetchingRate ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Fetch"
                      )}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Cash Batch</Label>
                  <Select
                    value={form.cash_batch_id}
                    onValueChange={(v) =>
                      updateField("cash_batch_id", v === "none" ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {cashBatches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {new Date(b.batch_date).toLocaleDateString()} — R
                          {Number(b.zar_withdrawn).toLocaleString()}
                          {b.local_currency && ` → ${b.local_currency}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    placeholder="Additional notes..."
                    rows={2}
                  />
                </div>
              </div>

              {/* Receipt Upload */}
              <div className="space-y-2">
                <Label>Receipt Image(s) *</Label>
                <div className="border-2 border-dashed border-rule-strong p-4 text-center">
                  {receiptFiles.length > 0 ? (
                    <div className="space-y-2">
                      {receiptFiles.map((file, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-sm bg-bone px-3 py-1.5"
                        >
                          <span className="truncate mr-2">{file.name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setReceiptFiles((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <label className="cursor-pointer">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          asChild
                        >
                          <span>
                            <Plus className="mr-1 h-3 w-3" />
                            Add more
                          </span>
                        </Button>
                        <input
                          type="file"
                          className="hidden"
                          multiple
                          accept="image/*,.pdf"
                          onChange={(e) => {
                            if (e.target.files?.length) {
                              setReceiptFiles((prev) => [
                                ...prev,
                                ...Array.from(e.target.files!),
                              ]);
                            }
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="cursor-pointer block py-2">
                      <Upload className="h-6 w-6 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Click to attach receipt photo(s)
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Images or PDF
                      </p>
                      <input
                        type="file"
                        className="hidden"
                        multiple
                        accept="image/*,.pdf"
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            setReceiptFiles(Array.from(e.target.files));
                          }
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
                {!editingId && receiptFiles.length === 0 && (
                  <p className="text-xs text-amber-600">
                    Please attach a receipt image for this expense
                  </p>
                )}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    loading ||
                    !form.category_id ||
                    !form.expense_date ||
                    !form.zar_amount ||
                    (!editingId && receiptFiles.length === 0)
                  }
                >
                  {loading
                    ? "Saving..."
                    : editingId
                    ? "Update Expense"
                    : "Add Expense"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No expenses recorded yet. Click &quot;Add Expense&quot; to start
          tracking.
        </p>
      ) : (
        <div className="overflow-x-auto border border-ink">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Local</TableHead>
                <TableHead className="text-right">ZAR</TableHead>
                <TableHead className="w-[40px]" />
                {!readOnly && <TableHead className="w-[100px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((exp) => (
                <TableRow key={exp.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(exp.expense_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {exp.receipt_code ?? "—"}
                  </TableCell>
                  <TableCell>
                    {exp.outreach_budget_categories?.name ?? "—"}
                  </TableCell>
                  <TableCell>{exp.vendor ?? "—"}</TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {exp.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {exp.payment_method.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {exp.local_amount != null
                      ? `${Number(exp.local_amount).toLocaleString()} ${exp.local_currency ?? ""}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {formatCurrency(Number(exp.zar_amount))}
                  </TableCell>
                  <TableCell>
                    <ReceiptGallery
                      expenseId={exp.id}
                      teamId={teamId}
                      receiptCount={receiptCounts[exp.id] || (exp.receipt_path ? 1 : 0)}
                      readOnly={readOnly}
                    />
                  </TableCell>
                  {!readOnly && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(exp)}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(exp.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {/* Total row */}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={7}>Total</TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(totalSpent)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
