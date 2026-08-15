"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Receipt, Loader2, AlertTriangle } from "lucide-react";
import { formatZAR } from "@/lib/finance/billing";

type Invoice = {
  student: string;
  dueDate: string;
  total: number;
  status: string;
  invoiceNumber?: string;
  error?: string;
};

export function GenerateInvoicesButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ranReal, setRanReal] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);

  async function run(dryRun: boolean) {
    if (!dryRun && !confirm("Generate and EMAIL these invoices in Xero now?")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/finance/school-fees/generate-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const json = await res.json();
      if (res.ok) {
        setInvoices(json.invoices ?? []);
        setRanReal(!dryRun);
        if (!dryRun) toast.success("Invoice run complete");
      } else {
        toast.error(json.error || "Failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setInvoices(null);
          setRanReal(false);
        }
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Receipt className="h-4 w-4 mr-1.5" /> Generate invoices
      </Button>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate due invoices</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Creates invoices in Xero for any scheduled charges whose generation
          date has arrived. The daily cron does this automatically — use this to
          preview or run on demand. Real runs <strong>authorise and email</strong>{" "}
          the student.
        </p>

        {invoices === null ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Click <strong>Preview</strong> to see what would generate today.
          </p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nothing due to generate today.
          </p>
        ) : (
          <div className="space-y-1 max-h-[340px] overflow-y-auto">
            {!ranReal && (
              <p className="text-xs text-muted-foreground">
                {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} would
                be generated:
              </p>
            )}
            {invoices.map((inv, i) => (
              <div
                key={i}
                className="flex items-center justify-between border border-rule-strong px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{inv.student}</p>
                  <p className="text-xs text-muted-foreground">
                    due {inv.dueDate}
                    {inv.invoiceNumber ? ` · ${inv.invoiceNumber}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{formatZAR(inv.total)}</span>
                  {inv.status === "failed" ? (
                    <Badge variant="destructive" className="text-[10px]">
                      <AlertTriangle className="h-3 w-3 mr-0.5" />
                      {inv.error ?? "failed"}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      {inv.status}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => run(true)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Preview (dry run)
          </Button>
          <Button onClick={() => run(false)} disabled={loading}>
            Generate &amp; send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
