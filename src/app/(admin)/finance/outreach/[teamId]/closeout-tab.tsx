"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, RotateCcw } from "lucide-react";

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

type Expense = {
  id: string;
  zar_amount: number;
};

type FundRelease = {
  id: string;
  amount_zar: number;
};

type Closeout = {
  id: string;
  team_id: string;
  total_funds_sent: number;
  total_spent: number;
  cash_remaining: number;
  funds_returned: number;
  variance: number;
  variance_pct: number;
  status: string;
  admin_notes: string | null;
  closed_by: string | null;
  closed_at: string | null;
  users?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
};

// ────────────────────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────────────────────

export function CloseoutTab({
  teamId,
  expenses,
  fundReleases,
  closeout: initialCloseout,
  canApprove = true,
}: {
  teamId: string;
  expenses: Expense[];
  fundReleases: FundRelease[];
  closeout: Closeout | null;
  /** Approving or rejecting a >2% variance is finance staff's call (migration 260). */
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [closeout, setCloseout] = useState<Closeout | null>(initialCloseout);
  const [cashRemaining, setCashRemaining] = useState("0");
  const [fundsReturned, setFundsReturned] = useState("0");
  const [adminNotes, setAdminNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);

  const totalFundsSent = fundReleases.reduce(
    (sum, r) => sum + Number(r.amount_zar),
    0
  );
  const totalSpent = expenses.reduce(
    (sum, e) => sum + Number(e.zar_amount),
    0
  );

  // Live variance calculation for the form
  const liveVariance =
    totalFundsSent -
    totalSpent -
    Number(cashRemaining || 0) -
    Number(fundsReturned || 0);
  const liveVariancePct =
    totalFundsSent > 0 ? (liveVariance / totalFundsSent) * 100 : 0;
  const willAutoClose = Math.abs(liveVariancePct) <= 2;

  async function handleInitiateCloseout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/outreach/closeouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: teamId,
          total_funds_sent: totalFundsSent,
          total_spent: totalSpent,
          cash_remaining: Number(cashRemaining || 0),
          funds_returned: Number(fundsReturned || 0),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to initiate closeout");
        return;
      }
      setCloseout(json.data);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusUpdate(status: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/outreach/closeouts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: teamId,
          status,
          admin_notes: adminNotes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to update closeout");
        return;
      }
      setCloseout(json.data);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleReinitiate() {
    setCloseout(null);
    setCashRemaining("0");
    setFundsReturned("0");
    setAdminNotes("");
  }

  // ────────────────────────────────────────────────────────────
  // RENDER: No closeout yet — show form
  // ────────────────────────────────────────────────────────────
  if (!closeout) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="font-medium text-lg">Closeout Reconciliation</h3>
          <p className="text-sm text-muted-foreground">
            Reconcile the team&apos;s finances. If variance is within 2%, the
            closeout will auto-approve.
          </p>
        </div>

        {/* Auto-computed summaries */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total Funds Sent</p>
              <p className="text-lg font-bold font-mono">
                {formatCurrency(totalFundsSent)}
              </p>
              <p className="text-xs text-muted-foreground">
                From {fundReleases.length} release(s)
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total Spent</p>
              <p className="text-lg font-bold font-mono">
                {formatCurrency(totalSpent)}
              </p>
              <p className="text-xs text-muted-foreground">
                From {expenses.length} expense(s)
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Variance</p>
              <p
                className={`text-lg font-bold font-mono ${
                  Math.abs(liveVariancePct) > 2
                    ? "text-destructive"
                    : "text-[color:var(--green-text)]"
                }`}
              >
                {formatCurrency(liveVariance)}
              </p>
              <p className="text-xs text-muted-foreground">
                {liveVariancePct.toFixed(2)}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Status</p>
              {willAutoClose ? (
                <Badge variant="default" className="mt-1">
                  Will auto-close
                </Badge>
              ) : (
                <Badge
                  variant="destructive"
                  className="mt-1"
                >
                  Requires admin review
                </Badge>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Input fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
          <div>
            <Label>Cash Remaining (ZAR)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={cashRemaining}
              onChange={(e) => setCashRemaining(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Cash left in hand at end of outreach
            </p>
          </div>
          <div>
            <Label>Funds Returned to FFSA (ZAR)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={fundsReturned}
              onChange={(e) => setFundsReturned(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Amount returned to FFSA accounts
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={handleInitiateCloseout} disabled={loading}>
          {loading ? "Processing..." : "Initiate Closeout"}
        </Button>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────
  // RENDER: Closeout exists — show status-specific view
  // ────────────────────────────────────────────────────────────
  const isClosed =
    closeout.status === "auto_closed" ||
    closeout.status === "admin_override";
  const isPending = closeout.status === "pending";
  const isRejected = closeout.status === "rejected";

  const closedByName = closeout.users
    ? `${closeout.users.first_name ?? ""} ${closeout.users.last_name ?? ""}`.trim()
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-lg">Closeout Reconciliation</h3>
          <p className="text-sm text-muted-foreground">
            {isClosed && "This team's finances are closed."}
            {isPending && "Variance exceeds 2% — admin review required."}
            {isRejected && "Closeout was rejected. You may re-initiate."}
          </p>
        </div>
        {isClosed && (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {closeout.status === "auto_closed"
              ? "Auto-Closed"
              : "Admin Approved"}
          </Badge>
        )}
        {isPending && (
          <Badge variant="secondary" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Pending Review
          </Badge>
        )}
        {isRejected && (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Rejected
          </Badge>
        )}
      </div>

      {/* Reconciliation Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Funds Sent</p>
            <p className="text-lg font-bold font-mono">
              {formatCurrency(Number(closeout.total_funds_sent))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Spent</p>
            <p className="text-lg font-bold font-mono">
              {formatCurrency(Number(closeout.total_spent))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Cash Remaining</p>
            <p className="text-lg font-bold font-mono">
              {formatCurrency(Number(closeout.cash_remaining))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Funds Returned</p>
            <p className="text-lg font-bold font-mono">
              {formatCurrency(Number(closeout.funds_returned))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Variance</p>
            <p
              className={`text-lg font-bold font-mono ${
                Math.abs(Number(closeout.variance_pct)) > 2
                  ? "text-destructive"
                  : "text-[color:var(--green-text)]"
              }`}
            >
              {formatCurrency(Number(closeout.variance))}
            </p>
            <p className="text-xs text-muted-foreground">
              {Number(closeout.variance_pct).toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Closed</p>
            {closeout.closed_at ? (
              <>
                <p className="text-sm font-medium">
                  {new Date(closeout.closed_at).toLocaleDateString()}
                </p>
                {closedByName && (
                  <p className="text-xs text-muted-foreground">
                    by {closedByName}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Admin notes display */}
      {closeout.admin_notes && (
        <div className="border border-rule-strong bg-bone p-4">
          <p className="text-xs text-muted-foreground font-medium mb-1">
            Admin Notes
          </p>
          <p className="text-sm">{closeout.admin_notes}</p>
        </div>
      )}

      {isPending && !canApprove && (
        <p className="border border-rule-strong p-4 text-sm text-muted-foreground">
          Variance is {Number(closeout.variance_pct).toFixed(2)}% (above the 2% threshold), so finance
          staff need to approve or reject this closeout.
        </p>
      )}

      {/* Pending: Admin actions */}
      {isPending && canApprove && (
        <div className="border border-rule-strong p-4 space-y-4">
          <h4 className="font-medium">Admin Decision</h4>
          <p className="text-sm text-muted-foreground">
            Variance is {Number(closeout.variance_pct).toFixed(2)}% (above 2%
            threshold). Review and approve or reject.
          </p>
          <div>
            <Label>Admin Notes</Label>
            <Textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Explanation for approval or rejection..."
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-3">
            <Button
              onClick={() => handleStatusUpdate("admin_override")}
              disabled={loading}
            >
              {loading ? "Processing..." : "Approve Override"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleStatusUpdate("rejected")}
              disabled={loading}
            >
              Reject
            </Button>
          </div>
        </div>
      )}

      {/* Rejected: Re-initiate option */}
      {isRejected && (
        <div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            variant="outline"
            onClick={handleReinitiate}
            className="gap-1"
          >
            <RotateCcw className="h-4 w-4" />
            Re-initiate Closeout
          </Button>
        </div>
      )}

      {/* Closed: Lock notice */}
      {isClosed && (
        <div className="border border-grass bg-bone p-4">
          <p className="text-sm text-[color:var(--green-text)]">
            This team&apos;s finances are closed. Expenses and payouts are
            locked and cannot be edited.
          </p>
        </div>
      )}
    </div>
  );
}
