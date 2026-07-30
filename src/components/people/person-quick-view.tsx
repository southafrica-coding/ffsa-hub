"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Phone, ArrowUpRight } from "lucide-react";
import type {
  PersonQuickView as PersonQuickViewData,
  PersonRef,
} from "@/services/person-quick-view";

const EMAIL_STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  delivered: { label: "Delivered", variant: "secondary" },
  opened: { label: "Opened", variant: "secondary" },
  sent: { label: "Sent", variant: "outline" },
  queued: { label: "Queued", variant: "outline" },
  bounced: { label: "Bounced", variant: "destructive" },
  complained: { label: "Spam", variant: "destructive" },
  unsubscribed: { label: "Unsubscribed", variant: "outline" },
  dropped: { label: "Dropped", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = secs / 60;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)}h ago`;
  const days = hrs / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function PersonQuickView({
  personRef,
  onClose,
}: {
  personRef: PersonRef | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<PersonQuickViewData | null>(null);
  const [loading, setLoading] = useState(false);
  const open = personRef !== null;

  useEffect(() => {
    if (!personRef) return;
    let cancelled = false;
    setData(null);
    setLoading(true);
    const params = new URLSearchParams();
    if (personRef.contactId) params.set("contactId", personRef.contactId);
    else if (personRef.userId) params.set("userId", personRef.userId);
    else if (personRef.email) params.set("email", personRef.email);
    fetch(`/api/people/quick-view?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d.person ?? null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [personRef]);

  const notDelivered = (data?.emailHistory ?? []).filter((e) =>
    ["bounced", "complained", "failed", "dropped"].includes(e.status)
  ).length;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto p-0"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-lg">
            {data?.name ?? personRef?.name ?? "Person"}
          </SheetTitle>
          {data && !loading && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {data.status && (
                <Badge
                  variant={data.status === "active" ? "default" : "outline"}
                  className="capitalize"
                >
                  {data.status}
                </Badge>
              )}
              {data.marketingStatus && (
                <Badge variant="outline" className="capitalize">
                  {data.marketingStatus.replace(/_/g, " ")}
                </Badge>
              )}
              {data.lite && (
                <Badge variant="outline">Not yet a saved contact</Badge>
              )}
            </div>
          )}
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !data || !data.found ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">
            No record found for this person.
          </div>
        ) : (
          <div className="px-5 py-4 space-y-6">
            {/* Contact details */}
            <section className="space-y-2">
              {data.primaryEmail && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{data.primaryEmail}</span>
                </div>
              )}
              {data.phones[0] && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{data.phones[0]}</span>
                </div>
              )}
              {data.labels.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {data.labels.map((l) => (
                    <Badge key={l.id} variant="secondary" className="capitalize">
                      {l.name}
                    </Badge>
                  ))}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-2 text-xs">
                {data.source && (
                  <Fact label="Source" value={data.source} />
                )}
                {data.createdAt && (
                  <Fact
                    label="Added"
                    value={new Date(data.createdAt).toLocaleDateString()}
                  />
                )}
                {data.lastInteractionAt && (
                  <Fact
                    label="Last interaction"
                    value={timeAgo(data.lastInteractionAt)}
                  />
                )}
              </dl>
            </section>

            {/* Email history */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Email history
                </h4>
                {notDelivered > 0 && (
                  <Badge variant="destructive">{notDelivered} not delivered</Badge>
                )}
              </div>
              {data.emailHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No emails on record yet.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.emailHistory.slice(0, 8).map((e) => {
                    const meta =
                      EMAIL_STATUS[e.status] ?? {
                        label: e.status,
                        variant: "outline" as const,
                      };
                    return (
                      <li
                        key={e.id}
                        className="flex items-start justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm truncate">{e.subject}</p>
                          <p className="text-xs text-muted-foreground">
                            <span className="capitalize">{e.channel}</span>
                            {e.sentAt ? ` · ${timeAgo(e.sentAt)}` : ""}
                          </p>
                        </div>
                        <Badge variant={meta.variant} className="shrink-0">
                          {meta.label}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Recent activity */}
            {data.activity.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Recent activity
                </h4>
                <ul className="space-y-2">
                  {data.activity.slice(0, 8).map((a) => (
                    <li
                      key={a.id}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate">{a.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(a.occurredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Full profile link(s) */}
            <div className="flex flex-col gap-2 pt-2 border-t">
              {data.contactId && (
                <Link
                  href={`/contacts/${data.contactId}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Open full contact profile
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              )}
              {personRef?.userId && (
                <Link
                  href={`/users/${personRef.userId}`}
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
                >
                  Open account record
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
