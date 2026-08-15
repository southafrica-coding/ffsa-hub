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
import { Plus, Trash2, Edit2 } from "lucide-react";

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

type FundRelease = {
  id: string;
  team_id: string;
  label: string;
  release_date: string | null;
  amount_zar: number;
  currency: string;
  method: string;
  recipient: string | null;
  notes: string | null;
};

type CashBatch = {
  id: string;
  team_id: string;
  batch_date: string;
  zar_withdrawn: number;
  bank_fee: number;
  local_currency: string | null;
  local_currency_received: number | null;
  exchange_rate: number | null;
  notes: string | null;
};

// ────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────

export function PayoutsTab({
  teamId,
  fundReleases,
  cashBatches,
  readOnly = false,
}: {
  teamId: string;
  fundReleases: FundRelease[];
  cashBatches: CashBatch[];
  readOnly?: boolean;
}) {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);

  return (
    <div className="space-y-8">
      <FundReleasesSection
        teamId={teamId}
        releases={fundReleases}
        formatCurrency={formatCurrency}
        readOnly={readOnly}
      />
      <CashBatchesSection
        teamId={teamId}
        batches={cashBatches}
        formatCurrency={formatCurrency}
        readOnly={readOnly}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// FUND RELEASES SECTION
// ────────────────────────────────────────────────────────────

function FundReleasesSection({
  teamId,
  releases,
  formatCurrency,
  readOnly = false,
}: {
  teamId: string;
  releases: FundRelease[];
  formatCurrency: (amount: number) => string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emptyForm = {
    label: "",
    release_date: "",
    amount_zar: "",
    currency: "ZAR",
    method: "bank_transfer",
    recipient: "",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  const totalReleased = releases.reduce(
    (sum, r) => sum + Number(r.amount_zar),
    0
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = {
        team_id: teamId,
        label: form.label,
        release_date: form.release_date || null,
        amount_zar: Number(form.amount_zar),
        currency: form.currency,
        method: form.method,
        recipient: form.recipient || null,
        notes: form.notes || null,
      };

      const method = editingId ? "PUT" : "POST";
      const body = editingId ? { id: editingId, ...payload } : payload;

      const res = await fetch("/api/finance/outreach/fund-releases", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }

      setAddOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this fund release?")) return;
    try {
      const res = await fetch(`/api/finance/outreach/fund-releases?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } catch {
      toast.error("Failed to delete");
    }
  }

  function openEdit(r: FundRelease) {
    setEditingId(r.id);
    setForm({
      label: r.label,
      release_date: r.release_date ?? "",
      amount_zar: String(r.amount_zar),
      currency: r.currency,
      method: r.method,
      recipient: r.recipient ?? "",
      notes: r.notes ?? "",
    });
    setAddOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Fund Releases</h3>
        <Dialog
          open={addOpen}
          onOpenChange={(v) => {
            setAddOpen(v);
            if (!v) {
              setEditingId(null);
              setForm(emptyForm);
              setError(null);
            }
          }}
        >
          {!readOnly && (
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add Release
              </Button>
            </DialogTrigger>
          )}
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Fund Release" : "Add Fund Release"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Label *</Label>
                  <Input
                    required
                    value={form.label}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, label: e.target.value }))
                    }
                    placeholder="e.g. Initial funding, Top-up #2"
                  />
                </div>
                <div>
                  <Label>Release Date</Label>
                  <DateInput
                    value={form.release_date}
                    onChange={(v) =>
                      setForm((p) => ({ ...p, release_date: v }))
                    }
                  />
                </div>
                <div>
                  <Label>Amount (ZAR) *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.amount_zar}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, amount_zar: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Input
                    value={form.currency}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, currency: e.target.value }))
                    }
                    placeholder="ZAR"
                  />
                </div>
                <div>
                  <Label>Method</Label>
                  <Select
                    value={form.method}
                    onValueChange={(v) =>
                      setForm((p) => ({ ...p, method: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">
                        Bank Transfer
                      </SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Recipient</Label>
                  <Input
                    value={form.recipient}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, recipient: e.target.value }))
                    }
                    placeholder="Who received the funds?"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, notes: e.target.value }))
                    }
                    rows={2}
                  />
                </div>
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
                  disabled={loading || !form.label || !form.amount_zar}
                >
                  {loading ? "Saving..." : editingId ? "Update" : "Add Release"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {releases.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No fund releases recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto border border-ink">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount (ZAR)</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Recipient</TableHead>
                {!readOnly && <TableHead className="w-[100px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell>
                    {r.release_date
                      ? new Date(r.release_date).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {formatCurrency(Number(r.amount_zar))}
                  </TableCell>
                  <TableCell>{r.currency}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {r.method.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.recipient ?? "—"}</TableCell>
                  {!readOnly && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(r)}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(r.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={2}>Total Released</TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(totalReleased)}
                </TableCell>
                <TableCell colSpan={4} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// CASH BATCHES SECTION
// ────────────────────────────────────────────────────────────

function CashBatchesSection({
  teamId,
  batches,
  formatCurrency,
  readOnly = false,
}: {
  teamId: string;
  batches: CashBatch[];
  formatCurrency: (amount: number) => string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emptyForm = {
    batch_date: "",
    zar_withdrawn: "",
    bank_fee: "",
    local_currency: "",
    local_currency_received: "",
    exchange_rate: "",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  function updateField(field: string, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-calculate exchange rate
      if (
        (field === "local_currency_received" ||
          field === "zar_withdrawn" ||
          field === "bank_fee") &&
        next.local_currency_received &&
        next.zar_withdrawn
      ) {
        const netZar =
          Number(next.zar_withdrawn) - (Number(next.bank_fee) || 0);
        if (netZar > 0) {
          next.exchange_rate = (
            Number(next.local_currency_received) / netZar
          ).toFixed(6);
        }
      }
      return next;
    });
  }

  const totalWithdrawn = batches.reduce(
    (sum, b) => sum + Number(b.zar_withdrawn),
    0
  );
  const totalFees = batches.reduce(
    (sum, b) => sum + Number(b.bank_fee),
    0
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = {
        team_id: teamId,
        batch_date: form.batch_date,
        zar_withdrawn: Number(form.zar_withdrawn),
        bank_fee: form.bank_fee ? Number(form.bank_fee) : 0,
        local_currency: form.local_currency || null,
        local_currency_received: form.local_currency_received
          ? Number(form.local_currency_received)
          : null,
        exchange_rate: form.exchange_rate ? Number(form.exchange_rate) : null,
        notes: form.notes || null,
      };

      const method = editingId ? "PUT" : "POST";
      const body = editingId ? { id: editingId, ...payload } : payload;

      const res = await fetch("/api/finance/outreach/cash-batches", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }

      setAddOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this cash batch?")) return;
    try {
      const res = await fetch(`/api/finance/outreach/cash-batches?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } catch {
      toast.error("Failed to delete");
    }
  }

  function openEdit(b: CashBatch) {
    setEditingId(b.id);
    setForm({
      batch_date: b.batch_date,
      zar_withdrawn: String(b.zar_withdrawn),
      bank_fee: String(b.bank_fee),
      local_currency: b.local_currency ?? "",
      local_currency_received:
        b.local_currency_received != null
          ? String(b.local_currency_received)
          : "",
      exchange_rate:
        b.exchange_rate != null ? String(b.exchange_rate) : "",
      notes: b.notes ?? "",
    });
    setAddOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Cash Batches</h3>
        <Dialog
          open={addOpen}
          onOpenChange={(v) => {
            setAddOpen(v);
            if (!v) {
              setEditingId(null);
              setForm(emptyForm);
              setError(null);
            }
          }}
        >
          {!readOnly && (
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add Cash Batch
              </Button>
            </DialogTrigger>
          )}
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Cash Batch" : "Add Cash Batch"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Batch Date *</Label>
                  <DateInput
                    required
                    value={form.batch_date}
                    onChange={(v) => updateField("batch_date", v)}
                  />
                </div>
                <div>
                  <Label>ZAR Withdrawn *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.zar_withdrawn}
                    onChange={(e) =>
                      updateField("zar_withdrawn", e.target.value)
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label>Bank Fee</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.bank_fee}
                    onChange={(e) => updateField("bank_fee", e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label>Local Currency</Label>
                  <Input
                    value={form.local_currency}
                    onChange={(e) =>
                      updateField("local_currency", e.target.value)
                    }
                    placeholder="e.g. BIF"
                  />
                </div>
                <div>
                  <Label>Local Amount Received</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.local_currency_received}
                    onChange={(e) =>
                      updateField("local_currency_received", e.target.value)
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label>Exchange Rate</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.000001"
                    value={form.exchange_rate}
                    onChange={(e) =>
                      updateField("exchange_rate", e.target.value)
                    }
                    placeholder="Auto-calculated"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    rows={2}
                  />
                </div>
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
                    loading || !form.batch_date || !form.zar_withdrawn
                  }
                >
                  {loading
                    ? "Saving..."
                    : editingId
                    ? "Update"
                    : "Add Batch"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No cash batches recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto border border-ink">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">ZAR Withdrawn</TableHead>
                <TableHead className="text-right">Bank Fee</TableHead>
                <TableHead>Local Currency</TableHead>
                <TableHead className="text-right">Local Received</TableHead>
                <TableHead className="text-right">Exchange Rate</TableHead>
                {!readOnly && <TableHead className="w-[100px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => {
                const netZar = Number(b.zar_withdrawn) - Number(b.bank_fee);
                const effectiveRate =
                  b.local_currency_received && netZar > 0
                    ? Number(b.local_currency_received) / netZar
                    : null;

                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      {new Date(b.batch_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(Number(b.zar_withdrawn))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatCurrency(Number(b.bank_fee))}
                    </TableCell>
                    <TableCell>{b.local_currency ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">
                      {b.local_currency_received != null
                        ? Number(b.local_currency_received).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {effectiveRate ? effectiveRate.toFixed(4) : "—"}
                    </TableCell>
                    {!readOnly && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(b)}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(b.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              <TableRow className="font-bold border-t-2">
                <TableCell>Total</TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(totalWithdrawn)}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {formatCurrency(totalFees)}
                </TableCell>
                <TableCell colSpan={4} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
