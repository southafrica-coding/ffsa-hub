import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  ContactEmailItem,
  ContactEmailChannel,
  ContactEmailStatus,
} from "@/services/contact-email-history";

// Per-contact email history (Phase 2). One list of every email this
// person has been sent — campaign, workflow and transactional — each
// with its delivery outcome, so "have our emails been reaching them?" is
// answerable at a glance from the contact record.

const STATUS_META: Record<
  ContactEmailStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  delivered: { label: "Delivered", variant: "secondary" },
  opened: { label: "Opened", variant: "secondary" },
  sent: { label: "Sent", variant: "outline" },
  queued: { label: "Queued", variant: "outline" },
  bounced: { label: "Bounced", variant: "destructive" },
  complained: { label: "Spam", variant: "destructive" },
  unsubscribed: { label: "Unsubscribed", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
  dropped: { label: "Dropped", variant: "destructive" },
};

const CHANNEL_LABEL: Record<ContactEmailChannel, string> = {
  campaign: "Campaign",
  workflow: "Workflow",
  transactional: "Transactional",
};

export function EmailHistoryCard({ items }: { items: ContactEmailItem[] }) {
  // Count anything that didn't reach the inbox, to headline problems.
  const problem = items.filter((i) =>
    ["bounced", "complained", "failed", "dropped"].includes(i.status)
  ).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Email history</CardTitle>
        {problem > 0 && (
          <Badge variant="destructive">
            {problem} not delivered
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No emails on record for this contact yet.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const meta =
                STATUS_META[item.status] ?? {
                  label: item.status,
                  variant: "outline" as const,
                };
              return (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {item.subject}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="uppercase tracking-[0.08em]">
                        {CHANNEL_LABEL[item.channel]}
                      </span>
                      {item.context && item.context !== item.subject
                        ? ` · ${item.context}`
                        : ""}
                      {item.sentAt
                        ? ` · ${new Date(item.sentAt).toLocaleString()}`
                        : ""}
                    </p>
                    {item.reason &&
                      ["bounced", "complained", "failed", "dropped"].includes(
                        item.status
                      ) && (
                        <p className="text-xs text-destructive mt-0.5">
                          {item.reason}
                        </p>
                      )}
                  </div>
                  <Badge variant={meta.variant} className="shrink-0">
                    {meta.label}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
