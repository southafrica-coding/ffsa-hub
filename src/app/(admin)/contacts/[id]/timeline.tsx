"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ActivityEvent = {
  id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown> | null;
  related_label_id: string | null;
  related_form_id: string | null;
  related_campaign_id: string | null;
  related_user_id: string | null;
  labels: { slug: string; name: string } | null;
  forms: { slug: string; name: string } | null;
  campaigns: { name: string; subject: string } | null;
};

const EVENT_LABEL: Record<string, string> = {
  contact_created: "Contact created",
  contact_updated: "Contact updated",
  contact_merged: "Contact merged",
  label_added: "Label added",
  label_removed: "Label removed",
  form_submitted: "Form submitted",
  csv_imported: "Imported from CSV",
  event_attended: "Attended event",
  email_sent: "Email sent",
  email_delivered: "Email delivered",
  email_opened: "Email opened",
  email_clicked: "Email clicked",
  email_bounced: "Email bounced",
  email_complained: "Email complained",
  email_unsubscribed: "Unsubscribed",
  note_added: "Note added",
  manual_interaction: "Manual interaction",
};

const EVENT_COLOR: Record<string, string> = {
  contact_created: "bg-green-100 text-green-800",
  label_added: "bg-blue-100 text-blue-800",
  label_removed: "bg-orange-100 text-orange-800",
  form_submitted: "bg-purple-100 text-purple-800",
  csv_imported: "bg-gray-100 text-gray-800",
  email_sent: "bg-cyan-100 text-cyan-800",
  email_opened: "bg-cyan-100 text-cyan-800",
  email_clicked: "bg-cyan-100 text-cyan-800",
  email_bounced: "bg-red-100 text-red-800",
  email_unsubscribed: "bg-red-100 text-red-800",
  note_added: "bg-yellow-100 text-yellow-800",
};

export function Timeline({
  contactId,
  events,
}: {
  contactId: string;
  events: ActivityEvent[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submitNote() {
    if (!note.trim()) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to add note");
      return;
    }
    setNote("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note about this contact…"
            rows={2}
            className="w-full border text-sm px-2 py-1.5 resize-none"
            disabled={busy}
          />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitNote}
              disabled={busy || !note.trim()}
              className="px-3 py-1 bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:bg-gray-300"
            >
              Add note
            </button>
          </div>
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="space-y-3">
            {events.map((ev) => (
              <li key={ev.id} className="flex gap-3">
                <span
                  className={`inline-block w-2 h-2 mt-2 ${
                    (EVENT_COLOR[ev.event_type] ?? "bg-gray-100").split(" ")[0]
                  }`}
                />
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-xs font-medium px-1.5 py-0.5 ${
                        EVENT_COLOR[ev.event_type] ?? "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {EVENT_LABEL[ev.event_type] ?? ev.event_type}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(ev.occurred_at).toLocaleString()}
                    </span>
                  </div>
                  <EventDetails ev={ev} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function EventDetails({ ev }: { ev: ActivityEvent }) {
  if (ev.event_type === "label_added" || ev.event_type === "label_removed") {
    return (
      <p className="text-sm text-gray-700">
        {ev.labels?.name ?? "Unknown label"}
        {ev.payload?.added_via ? (
          <span className="text-xs text-gray-500"> · via {String(ev.payload.added_via)}</span>
        ) : null}
      </p>
    );
  }
  if (ev.event_type === "form_submitted") {
    return (
      <p className="text-sm text-gray-700">
        Form: {ev.forms?.name ?? "—"}
      </p>
    );
  }
  if (ev.event_type === "csv_imported") {
    return (
      <p className="text-sm text-gray-700">
        {ev.labels?.name ? `Tagged with ${ev.labels.name}` : "CSV import"}
      </p>
    );
  }
  if (ev.event_type === "note_added" && ev.payload?.note) {
    return (
      <p className="text-sm text-gray-700 whitespace-pre-wrap">
        {String(ev.payload.note)}
      </p>
    );
  }
  if (
    ev.event_type === "email_sent" ||
    ev.event_type === "email_delivered" ||
    ev.event_type === "email_opened" ||
    ev.event_type === "email_clicked" ||
    ev.event_type === "email_bounced"
  ) {
    return (
      <p className="text-sm text-gray-700">
        {ev.campaigns?.subject ?? ev.campaigns?.name ?? "Campaign"}
      </p>
    );
  }
  return null;
}
