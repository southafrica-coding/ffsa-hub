"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Car } from "lucide-react";
import { WidgetShell, WidgetEmpty } from "./widget-shell";

type Request = {
  id: string;
  requesterName: string | null;
  purpose: string | null;
  purposeNote: string | null;
  checkoutDate: string | null;
  returnDate: string | null;
};

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

export function VehiclesCard() {
  const [requests, setRequests] = useState<Request[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/vehicles", { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { requests: Request[] };
          setRequests(json.requests ?? []);
        } else {
          setRequests([]);
        }
      } catch {
        setRequests([]);
      }
    })();
  }, []);

  if (requests === null) {
    return (
      <WidgetShell title="Vehicle Requests">
        <WidgetEmpty>Loading…</WidgetEmpty>
      </WidgetShell>
    );
  }

  if (requests.length === 0) {
    return (
      <WidgetShell title="Vehicle Requests" href="/bookings/vehicles" hrefLabel="Fleet">
        <WidgetEmpty>No pending vehicle requests.</WidgetEmpty>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title="Vehicle Requests" href="/bookings/vehicles" hrefLabel="Review all">
      <div>
        {requests.map((r) => {
          const span = [dateLabel(r.checkoutDate), dateLabel(r.returnDate)]
            .filter(Boolean)
            .join(" – ");
          const purpose = r.purposeNote?.trim() || r.purpose?.replace(/_/g, " ") || "Vehicle request";
          return (
            <Link
              key={r.id}
              href="/bookings/vehicles"
              className="flex items-center justify-between transition-colors duration-150"
              style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid hsl(22 8% 11%)" }}
            >
              <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                <Car className="h-4 w-4" style={{ color: "hsl(42 95% 55%)", flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "#F0EBE3" }} className="truncate">
                    {r.requesterName ?? "Vehicle request"}
                  </p>
                  <p style={{ fontSize: "11px", color: "hsl(30 8% 42%)", marginTop: "2px" }} className="truncate">
                    {purpose}
                    {span ? ` · ${span}` : ""}
                  </p>
                </div>
              </div>
              <ArrowUpRight className="h-3 w-3" style={{ color: "hsl(42 95% 55%)", flexShrink: 0 }} />
            </Link>
          );
        })}
      </div>
    </WidgetShell>
  );
}
