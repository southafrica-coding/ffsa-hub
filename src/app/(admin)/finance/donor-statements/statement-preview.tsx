"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Drawer, StatusPill } from "@/components/ffsa";
import { fmtUsd, type Donor } from "@/lib/finance/donor-statements";

// One donor's statement exactly as it would go out: the email (From,
// Reply-To, subject, body, attachment name) and the PDF itself, plus a test
// send to any address. Prev / next step through the list being reviewed.

type EmailPreview = {
  subject: string;
  html: string;
  to: string | null;
  toValid: boolean;
  fromName: string;
  fromEmail: string | null;
  replyTo: string | null;
  fileName: string;
  missingImages: string[];
};

const TEST_TO_KEY = "donor-statements:test-to";

export function StatementPreview({
  runId,
  donors,
  index,
  onIndex,
  onClose,
}: {
  runId: string;
  donors: Donor[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const donor = index === null ? null : donors[index];
  const [email, setEmail] = useState<EmailPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    try {
      setTestTo(localStorage.getItem(TEST_TO_KEY) ?? "");
    } catch {
      // storage blocked — the field just starts empty
    }
  }, []);

  useEffect(() => {
    if (!donor) return;
    setEmail(null);
    setError(null);
    fetch(`/api/finance/donor-statements/runs/${runId}/statement?donor=${encodeURIComponent(donor.key)}&view=email`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Preview failed");
        setEmail(j);
      })
      .catch((e) => setError(e.message));
  }, [runId, donor]);

  if (!donor) return null;
  const pdfUrl = `/api/finance/donor-statements/runs/${runId}/statement?donor=${encodeURIComponent(donor.key)}`;

  async function sendTest() {
    if (!donor) return;
    setSending(true);
    try {
      localStorage.setItem(TEST_TO_KEY, testTo.trim());
    } catch {
      // not remembered — fine
    }
    const res = await fetch(`/api/finance/donor-statements/runs/${runId}/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donor: donor.key, to: testTo.trim() }),
    });
    const j = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) return toast.error(j.error ?? "Test send failed");
    toast.success(`Test of ${donor.name}'s statement sent to ${testTo.trim()}`);
  }

  return (
    <Drawer
      open
      onClose={onClose}
      label={`Statement · ${donor.name}`}
      onPrev={index! > 0 ? () => onIndex(index! - 1) : undefined}
      onNext={index! < donors.length - 1 ? () => onIndex(index! + 1) : undefined}
    >
      <div className="space-y-5 px-6 py-6">
        <div>
          <div className="font-display text-[26px] font-black uppercase leading-none">{donor.name}</div>
          <div className="mt-1.5 text-sm text-[color:var(--text-tertiary)]">
            {fmtUsd(donor.totalCents)} · {donor.gifts.length} gift{donor.gifts.length === 1 ? "" : "s"}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!email && !error && <p className="text-sm text-[color:var(--text-tertiary)]">Putting the email together…</p>}

        {email && (
          <div className="border border-ink">
            <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 border-b border-rule p-4 text-sm">
              <dt className="mono-label pt-0.5">From</dt>
              <dd>
                {email.fromName} &lt;{email.fromEmail ?? "not set — apply migration 246"}&gt;
              </dd>
              <dt className="mono-label pt-0.5">Reply-To</dt>
              <dd>{email.replyTo ?? "—"}</dd>
              <dt className="mono-label pt-0.5">To</dt>
              <dd>
                {email.to ? (
                  <span className={email.toValid ? undefined : "text-destructive"}>{email.to}</span>
                ) : (
                  <StatusPill tone="bad">No email — paper statement</StatusPill>
                )}
              </dd>
              <dt className="mono-label pt-0.5">Subject</dt>
              <dd className="font-semibold">{email.subject}</dd>
              <dt className="mono-label pt-0.5">Attached</dt>
              <dd>{email.fileName}</dd>
            </dl>
            <iframe title="Email body" srcDoc={email.html} className="h-[420px] w-full bg-white" sandbox="allow-same-origin" />
          </div>
        )}

        {email && email.missingImages.length > 0 && (
          <p className="text-sm text-amber">
            No {email.missingImages.join(" or ")} uploaded yet — add {email.missingImages.length > 1 ? "them" : "it"} in Settings.
          </p>
        )}

        <div className="border border-ink">
          <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
            <span className="mono-label">PDF statement</span>
            <a
              href={`${pdfUrl}&download=1`}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:text-electric"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
          </div>
          <iframe key={donor.key} title="PDF statement" src={pdfUrl} className="h-[640px] w-full bg-white" />
        </div>

        <div className="border border-ink p-4">
          <span className="mono-label mb-2 block">Send a test</span>
          <p className="mb-3 text-xs text-[color:var(--text-tertiary)]">
            Sends this exact email and PDF to the address below instead of to {donor.name}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              type="email"
              className="h-9 w-72"
              placeholder="you@ffsouthafrica.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button size="sm" onClick={sendTest} disabled={sending || !testTo.trim()}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {sending ? "Sending…" : "Send test"}
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
