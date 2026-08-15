import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionBar, StatusPill, type Tone } from "@/components/ffsa";


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
function statusFor(r: RecipientRow): { label: string; tone: Tone; at: string | null } {
  if (r.complained_at)
    return { label: "Spam", tone: "bad", at: r.complained_at };
  // Only a bounce that never delivered counts. A transient bounce (e.g.
  // Mailtrap "hourly_rate_exceeded") stamps bounced_at but later delivers —
  // such a recipient should show its real reached status, not "Bounced".
  if (r.bounced_at && !r.delivered_at)
    return { label: "Bounced", tone: "bad", at: r.bounced_at };
  if (r.unsubscribed_at)
    return { label: "Unsubscribed", tone: "quiet", at: r.unsubscribed_at };
  if (r.first_clicked_at)
    return { label: "Clicked", tone: "good", at: r.first_clicked_at };
  if (r.opened_at)
    return { label: "Opened", tone: "good", at: r.opened_at };
  if (r.delivered_at)
    return { label: "Delivered", tone: "good", at: r.delivered_at };
  if (r.sent_at) return { label: "Sent", tone: "warn", at: r.sent_at };
  return { label: "Pending", tone: "quiet", at: null };
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
    <div className="border border-ink bg-white">
      <SectionBar
        title="Delivery by recipient"
        meta={`${recipients.length.toLocaleString()} recipients`}
      />
      <div className="max-h-[28rem] overflow-x-auto overflow-y-auto">
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
                      <div className="text-xs text-[color:var(--text-tertiary)]">
                        {r.contacts.email}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusPill tone={s.tone}>{s.label}</StatusPill>
                  </TableCell>
                  <TableCell className="tabular text-xs text-[color:var(--text-tertiary)]">
                    {s.at ? new Date(s.at).toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
