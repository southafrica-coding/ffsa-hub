import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Contact = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
} | null;

export type RecipientRow = {
  id: string;
  contact_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  first_clicked_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  unsubscribed_at: string | null;
  contacts: Contact;
};

// Furthest-reached status for a recipient, worst-case (bounce/complaint) first.
function statusFor(r: RecipientRow): { label: string; cls: string; at: string | null } {
  if (r.complained_at)
    return { label: "Spam", cls: "status-red", at: r.complained_at };
  // Only a bounce that never delivered counts. A transient bounce (e.g.
  // Mailtrap "hourly_rate_exceeded") stamps bounced_at but later delivers —
  // such a recipient should show its real reached status, not "Bounced".
  if (r.bounced_at && !r.delivered_at)
    return { label: "Bounced", cls: "status-red", at: r.bounced_at };
  if (r.unsubscribed_at)
    return { label: "Unsubscribed", cls: "status-grey", at: r.unsubscribed_at };
  if (r.first_clicked_at)
    return { label: "Clicked", cls: "status-green", at: r.first_clicked_at };
  if (r.opened_at)
    return { label: "Opened", cls: "status-green", at: r.opened_at };
  if (r.delivered_at)
    return { label: "Delivered", cls: "status-green", at: r.delivered_at };
  if (r.sent_at) return { label: "Sent", cls: "status-yellow", at: r.sent_at };
  return { label: "Pending", cls: "status-grey", at: null };
}

function nameFor(c: Contact): string {
  if (!c) return "Unknown";
  const full = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return full || c.email || "Unknown";
}

export function CampaignRecipientsTable({
  recipients,
}: {
  recipients: RecipientRow[];
}) {
  if (recipients.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Delivery by recipient ({recipients.length.toLocaleString()})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-card overflow-x-auto max-h-[28rem] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((r) => {
                const s = statusFor(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{nameFor(r.contacts)}</div>
                      {r.contacts?.email && (
                        <div className="text-xs text-muted-foreground">
                          {r.contacts.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}
                      >
                        {s.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {s.at ? new Date(s.at).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
