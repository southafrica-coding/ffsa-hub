"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";

type Payment = {
  id: string;
  payment_date: string;
  amount_zar: number;
  payment_method: string;
  reference: string | null;
};

type StudentFee = {
  id: string;
  tier: string;
  tuition_zar: number;
  accommodation_zar: number;
  meals_zar: number;
  materials_zar: number;
  total_due_zar: number;
  discount_zar: number;
  scholarship_zar: number;
  final_amount_zar: number;
  amount_paid_zar: number;
  status: string;
  programs: { id: string; name: string; code: string };
  student_payments: Payment[];
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(amount);

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-bone text-ink",
  partially_paid: "bg-yellow-dim text-amber",
  paid: "bg-white text-grass-text",
  overdue: "bg-white text-destructive",
  waived: "bg-blue-100 text-electric",
};

const TIER_LABELS: Record<string, string> = {
  A: "Tier A",
  B: "Tier B",
  C: "Tier C",
};

export function SchoolFeesCard({ fee }: { fee: StudentFee }) {
  const [expanded, setExpanded] = useState(false);

  const balance = Number(fee.final_amount_zar) - Number(fee.amount_paid_zar);
  const payments = fee.student_payments ?? [];
  const pctPaid =
    Number(fee.final_amount_zar) > 0
      ? (Number(fee.amount_paid_zar) / Number(fee.final_amount_zar)) * 100
      : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{fee.programs.name}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {fee.programs.code}
            </Badge>
            <Badge
              variant={
                fee.tier === "A"
                  ? "default"
                  : fee.tier === "C"
                    ? "destructive"
                    : "secondary"
              }
              className="text-xs"
            >
              {TIER_LABELS[fee.tier]}
            </Badge>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                STATUS_COLORS[fee.status] ?? ""
              }`}
            >
              {fee.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Fee Breakdown */}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tuition</span>
            <span className="font-mono">
              {formatCurrency(Number(fee.tuition_zar))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Accommodation</span>
            <span className="font-mono">
              {formatCurrency(Number(fee.accommodation_zar))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Meals</span>
            <span className="font-mono">
              {formatCurrency(Number(fee.meals_zar))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Materials</span>
            <span className="font-mono">
              {formatCurrency(Number(fee.materials_zar))}
            </span>
          </div>

          {(Number(fee.discount_zar) > 0 ||
            Number(fee.scholarship_zar) > 0) && (
            <>
              <div className="border-t my-1" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">
                  {formatCurrency(Number(fee.total_due_zar))}
                </span>
              </div>
              {Number(fee.discount_zar) > 0 && (
                <div className="flex justify-between text-grass-text">
                  <span>Discount</span>
                  <span className="font-mono">
                    -{formatCurrency(Number(fee.discount_zar))}
                  </span>
                </div>
              )}
              {Number(fee.scholarship_zar) > 0 && (
                <div className="flex justify-between text-grass-text">
                  <span>Scholarship</span>
                  <span className="font-mono">
                    -{formatCurrency(Number(fee.scholarship_zar))}
                  </span>
                </div>
              )}
            </>
          )}

          <div className="border-t pt-1 flex justify-between font-medium">
            <span>Total Due</span>
            <span className="font-mono">
              {formatCurrency(Number(fee.final_amount_zar))}
            </span>
          </div>
        </div>

        {/* Payment Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              Paid: {formatCurrency(Number(fee.amount_paid_zar))}
            </span>
            <span>{pctPaid.toFixed(0)}%</span>
          </div>
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${Math.min(pctPaid, 100)}%` }}
            />
          </div>
        </div>

        {/* Balance */}
        <div className="flex justify-between text-sm font-medium">
          <span>Balance Remaining</span>
          <span
            className={`font-mono ${
              balance > 0 ? "text-destructive" : "text-grass-text"
            }`}
          >
            {formatCurrency(balance)}
          </span>
        </div>

        {/* Payment History */}
        {payments.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Payment history ({payments.length})
            </button>
            {expanded && (
              <div className="mt-2 space-y-1">
                {payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between text-xs py-1 border-b border-muted last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span>
                        {new Date(p.payment_date).toLocaleDateString()}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">
                        {p.payment_method.toUpperCase()}
                      </Badge>
                      {p.reference && (
                        <span className="text-muted-foreground">
                          {p.reference}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-grass-text">
                      {formatCurrency(Number(p.amount_zar))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
