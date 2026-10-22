"use client";

import { CurrencySelect } from "@/components/ui/currency-select";
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
import { pullPrice, rateText, summarisePulls, uncoveredCash, type AllocationRow } from "@/lib/finance/outreach-pulls";
import { createClient } from "@/lib/supabase/client";

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
  proof_path?: string | null;
};

// ────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────

export function PayoutsTab({
  teamId,
  fundReleases,
  cashBatches,
  allocations = [],
  readOnly = false,
}: {
  teamId: string;
  fundReleases: FundRelease[];
  cashBatches: CashBatch[];
  /** Cash spending charged to pulls, oldest first (migration 263). */
  allocations?: AllocationRow[];
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
        allocations={allocations}
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
// CASH PULLS SECTION
// ────────────────────────────────────────────────────────────

const localFmt = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 2 });

/**
 * Each ATM pull is priced on its own (migration 263): the cash you got,
 * the rand that left the account, and the part the bank showed as a fee.
 * The rate is worked out, never typed. Cash spending is charged to pulls
 * oldest first, so each row shows what's spent and what's left of it.
 */
function CashBatchesSection({
  teamId,
  batches,
  allocations,
  formatCurrency,
  readOnly = false,
}: {
  teamId: string;
  batches: CashBatch[];
  allocations: AllocationRow[];
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
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [proofFile, setProofFile] = useState<File | null>(null);

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const price = pullPrice({
    zarOut: Number(form.zar_withdrawn) || 0,
    fee: Number(form.bank_fee) || 0,
    localReceived: Number(form.local_currency_received) || 0,
  });

  // Oldest first, the order cash is spent in.
  const ordered = [...batches].sort((a, b) => a.batch_date.localeCompare(b.batch_date));
  const summaries = new Map(summarisePulls(ordered, allocations).map((p) => [p.id, p]));
  const uncovered = uncoveredCash(allocations);
  const totalWithdrawn = batches.reduce((sum, b) => sum + Number(b.zar_withdrawn), 0);
  const totalFees = batches.reduce((sum, b) => sum + Number(b.bank_fee), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // The bank screenshot, if they attached one (optional).
      let proofPath: string | undefined;
      if (proofFile) {
        const path = `${teamId}/pulls/${Date.now()}_${proofFile.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
        const { error: upErr } = await createClient().storage.from("outreach-receipts").upload(path, proofFile);
        if (upErr) toast.error("The screenshot didn't upload — saving the pull without it");
        else proofPath = path;
      }

      const payload = {
        team_id: teamId,
        ...(proofPath ? { proof_path: proofPath } : {}),
        batch_date: form.batch_date,
        zar_withdrawn: Number(form.zar_withdrawn),
        bank_fee: form.bank_fee ? Number(form.bank_fee) : 0,
        local_currency: form.local_currency,
        local_currency_received: Number(form.local_currency_received),
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
      setProofFile(null);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this cash pull? Cash spent from it moves to the next pull, or shows as not covered.")) return;
    try {
      const res = await fetch(`/api/finance/outreach/cash-batches?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
      else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete");
    }
  }

  function openEdit(b: CashBatch) {
    setEditingId(b.id);
    setForm({
      batch_date: b.batch_date,
      zar_withdrawn: String(b.zar_withdrawn),
      bank_fee: Number(b.bank_fee) ? String(b.bank_fee) : "",
      local_currency: b.local_currency ?? "",
      local_currency_received:
        b.local_currency_received != null ? String(b.local_currency_received) : "",
      notes: b.notes ?? "",
    });
    setAddOpen(true);
  }

  const canSave =
    form.batch_date &&
    form.local_currency &&
    Number(form.local_currency_received) > 0 &&
    Number(form.zar_withdrawn) > 0 &&
    price.localPerZar !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Cash pulls</h3>
          <p className="text-xs text-muted-foreground">
            Each ATM pull keeps its own rate. Cash spending is charged to the oldest pull first.
          </p>
        </div>
        <Dialog
          open={addOpen}
          onOpenChange={(v) => {
            setAddOpen(v);
            if (!v) {
              setEditingId(null);
              setForm(emptyForm);
              setProofFile(null);
              setError(null);
            }
          }}
        >
          {!readOnly && (
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add cash pull
              </Button>
            </DialogTrigger>
          )}
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit cash pull" : "Add cash pull"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Date *</Label>
                  <DateInput
                    required
                    value={form.batch_date}
                    onChange={(v) => updateField("batch_date", v)}
                  />
                </div>
                <div>
                  <Label>Currency *</Label>
                  <CurrencySelect
                    value={form.local_currency}
                    onChange={(v) => updateField("local_currency", v)}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Cash you got *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.local_currency_received}
                    onChange={(e) => updateField("local_currency_received", e.target.value)}
                    placeholder={form.local_currency ? `Count it — in ${form.local_currency}` : "Count it"}
                  />
                </div>
                <div>
                  <Label>Rand that left the account *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.zar_withdrawn}
                    onChange={(e) => updateField("zar_withdrawn", e.target.value)}
                    placeholder="From your bank app"
                  />
                </div>
                <div>
                  <Label>Of that, bank fee</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.bank_fee}
                    onChange={(e) => updateField("bank_fee", e.target.value)}
                    placeholder="Only if shown separately"
                  />
                </div>
                <div className="col-span-2 border border-rule px-3 py-2 text-sm">
                  {price.localPerZar !== null && price.zarPerLocal !== null ? (
                    <>
                      <span className="text-muted-foreground">This pull&apos;s rate: </span>
                      <strong className="font-mono">{rateText(price.localPerZar, form.local_currency || "local")}</strong>
                      <span className="text-muted-foreground">
                        {" "}
                        · cash cost {formatCurrency(price.cost)}
                        {Number(form.bank_fee) > 0 && ` + ${formatCurrency(Number(form.bank_fee))} fee (logged in Bank Costs)`}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      The rate is worked out from the cash you got and the rand that left the account.
                    </span>
                  )}
                </div>
                <div className="col-span-2">
                  <Label>Bank notification screenshot</Label>
                  <Input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Optional — kept as proof. Or send it to the Outreach Finance bot in Slack.
                  </p>
                </div>
                <div className="col-span-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    rows={2}
                    placeholder="e.g. Ecobank ATM, Bujumbura"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading || !canSave}>
                  {loading ? "Saving..." : editingId ? "Update" : "Add pull"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {uncovered.length > 0 && (
        <p className="border border-amber-border px-3 py-2 text-sm text-amber">
          {uncovered
            .map((u) => `${localFmt(u.local)} ${u.currency} of cash spending has no cash pull to cover it`)
            .join(" · ")}{" "}
          — is a pull missing? Until one is added it&apos;s priced at the newest pull&apos;s rate.
        </p>
      )}

      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No cash pulls recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto border border-ink">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Cash got</TableHead>
                <TableHead className="text-right">Rand out</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Spent</TableHead>
                <TableHead className="text-right">Left</TableHead>
                {!readOnly && <TableHead className="w-[100px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((b) => {
                const sum = summaries.get(b.id);
                const cur = b.local_currency ?? "";
                const rate = sum && sum.cost > 0 && sum.localReceived > 0 ? sum.localReceived / sum.cost : null;
                return (
                  <TableRow key={b.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(b.batch_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">
                      {b.local_currency_received != null ? `${localFmt(Number(b.local_currency_received))} ${cur}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(Number(b.zar_withdrawn))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {Number(b.bank_fee) ? formatCurrency(Number(b.bank_fee)) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                      {rate ? rateText(rate, cur) : "—"}
                      {b.proof_path && (
                        <div>
                          <a
                            href={`/api/finance/outreach/cash-batches/proof?id=${b.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-electric underline"
                          >
                            📎 Screenshot
                          </a>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                      {sum ? (
                        <>
                          {localFmt(sum.localSpent)} {cur}
                          <div className="text-muted-foreground">{formatCurrency(sum.zarSpent)}</div>
                        </>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                      {sum ? (
                        <>
                          {localFmt(sum.localLeft)} {cur}
                          <div className="text-muted-foreground">{formatCurrency(sum.zarLeft)}</div>
                        </>
                      ) : "—"}
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
                <TableCell colSpan={2}>Total</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(totalWithdrawn)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{formatCurrency(totalFees)}</TableCell>
                <TableCell colSpan={readOnly ? 3 : 4} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
