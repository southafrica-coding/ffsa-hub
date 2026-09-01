"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Car, KeyRound, RotateCcw, XCircle } from "lucide-react";
import { WidgetShell, WidgetEmpty } from "./widget-shell";

type Request = {
  id: string;
  requesterName: string | null;
  purpose: string | null;
  purposeNote: string | null;
  checkoutDate: string | null;
  returnDate: string | null;
};

type Activity = {
  id: string;
  bookingId: string | null;
  kind: "collected" | "returned" | "cancelled";
  bookingName: string | null;
  at: string;
};

const ACTIVITY_COPY: Record<Activity["kind"], { verb: string; Icon: typeof Car }> = {
  collected: { verb: "signed out", Icon: KeyRound },
  returned: { verb: "signed in", Icon: RotateCcw },
  cancelled: { verb: "cancelled", Icon: XCircle },
};

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

export function VehiclesCard() {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/vehicles", { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as {
            requests: Request[];
            activity?: Activity[];
          };
          setRequests(json.requests ?? []);
          setActivity(json.activity ?? []);
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

  if (requests.length === 0 && activity.length === 0) {
    return (
      <WidgetShell title="Vehicle Requests" href="/bookings/vehicles" hrefLabel="Fleet">
        <WidgetEmpty>No pending vehicle requests.</WidgetEmpty>
      </WidgetShell>
    );
  }

  if (requests.length === 0) {
    return (
      <WidgetShell title="Vehicle Requests" href="/bookings/vehicles" hrefLabel="Fleet">
        <ActivityList activity={activity} />
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
              style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid var(--surface-2)" }}
            >
              <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                <Car className="h-4 w-4" style={{ color: "var(--ink)", flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }} className="truncate">
                    {r.requesterName ?? "Vehicle request"}
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }} className="truncate">
                    {purpose}
                    {span ? ` · ${span}` : ""}
                  </p>
                </div>
              </div>
              <ArrowUpRight className="h-3 w-3" style={{ color: "var(--ink)", flexShrink: 0 }} />
            </Link>
          );
        })}
      </div>
      <ActivityList activity={activity} />
    </WidgetShell>
  );
}

/** Recent sign-outs, sign-ins and cancellations across the fleet. */
function ActivityList({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) return null;
  return (
    <div>
      <p
        className="mono-label"
        style={{ padding: "0.75rem 1.5rem 0.25rem", color: "var(--text-tertiary)" }}
      >
        Recent activity
      </p>
      {activity.map((a) => {
        const { verb, Icon } = ACTIVITY_COPY[a.kind];
        return (
          <Link
            key={a.id}
            href={a.bookingId ? `/bookings/vehicles/${a.bookingId}` : "/bookings/vehicles"}
            className="flex items-center justify-between transition-colors duration-150"
            style={{ padding: "0.5rem 1.5rem", borderBottom: "1px solid var(--surface-2)" }}
          >
            <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
              <Icon className="h-4 w-4" style={{ color: "var(--ink)", flexShrink: 0 }} />
              <p
                style={{ fontSize: "12px", color: "var(--text-secondary)" }}
                className="truncate"
              >
                <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                  {a.bookingName ?? "Booking"}
                </span>{" "}
                {verb} · {dateLabel(a.at)}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
