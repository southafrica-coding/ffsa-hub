import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionBar, StatusPill } from "@/components/ffsa";
import { recipientLogStatus } from "@/lib/email/delivery-state";


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

// Sent and delivered are success. A missing open or click is not a warning —
// open and click tracking is off. A bounce that later delivered stays delivered.

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
              const s = recipientLogStatus(r);
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
