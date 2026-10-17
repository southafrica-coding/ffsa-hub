"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionBar, StatusPill } from "@/components/ffsa";
import { fmtUsd, type Donor } from "@/lib/finance/donor-statements";
import type { SendRow } from "@/lib/finance/donor-statements-server";

// Sending: everyone not yet sent, or the ticked donors, in small batches
// with progress — then the paper pile and the log of everything sent.

const api = "/api/finance/donor-statements";
const BATCH = 8;

export type SendResult = { key: string; name: string; status: string; error: string | null };
export type SendSkip = { key: string; name: string; reason: string };

/** Latest email and paper sends per donor. */
export function sendIndex(rows: SendRow[]) {
  const email = new Map<string, SendRow>();
  const paper = new Map<string, SendRow>();
  for (const r of rows) {
    const m = r.channel === "email" ? email : paper;
    const cur = m.get(r.donor_key);
    // A sent row outranks a later failure, so "already sent" stays true.
    if (!cur || (cur.status !== "sent" && r.status === "sent")) m.set(r.donor_key, r);
  }
  return { email, paper };
}

export async function sendInBatches(
  runId: string,
  keys: string[],
  opts: { resend?: boolean; onProgress?: (done: number) => void } = {}
): Promise<{ results: SendResult[]; skipped: SendSkip[] }> {
  const results: SendResult[] = [];
  const skipped: SendSkip[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const res = await fetch(`${api}/runs/${runId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donors: keys.slice(i, i + BATCH), resend: opts.resend === true }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? `Send failed (${res.status})`);
    results.push(...j.results);
    skipped.push(...j.skipped);
    opts.onProgress?.(Math.min(keys.length, i + BATCH));
  }
  return { results, skipped };
}

export function SendPanel({
  runId,
  year,
  donors,
  selected,
  sends,
  blocker,
  onDone,
}: {
  runId: string;
  year: number;
  donors: Donor[];
  selected: Set<string>;
  sends: SendRow[];
  blocker: string | null;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [last, setLast] = useState<{ results: SendResult[]; skipped: SendSkip[] } | null>(null);
  const [zipping, setZipping] = useState(false);

  const idx = sendIndex(sends);
  const sendable = donors.filter((d) => !d.excluded && d.totalCents > 0 && d.emailValid);
  const notYet = sendable.filter((d) => idx.email.get(d.key)?.status !== "sent");
  const paper = donors.filter((d) => !d.excluded && d.totalCents > 0 && !d.emailValid);
  const picked = sendable.filter((d) => selected.has(d.key));
  const pickedAlready = picked.filter((d) => idx.email.get(d.key)?.status === "sent");
  const sentCount = sendable.length - notYet.length;
  const busy = progress !== null;

  async function run(list: Donor[], label: string) {
    if (list.length === 0) return;
    const total = list.reduce((s, d) => s + d.totalCents, 0);
    if (!confirm(`${label}\n\n${list.length} donor${list.length === 1 ? "" : "s"} · ${fmtUsd(total)}\n\nThis emails real donors. Continue?`)) return;
    setProgress({ done: 0, total: list.length });
    setLast(null);
    try {
      const out = await sendInBatches(runId, list.map((d) => d.key), {
        onProgress: (done) => setProgress({ done, total: list.length }),
      });
      setLast(out);
      const ok = out.results.filter((r) => r.status === "sent").length;
      const failed = out.results.length - ok;
      if (failed) toast.error(`${ok} sent, ${failed} failed — see below`);
      else toast.success(`${ok} statement${ok === 1 ? "" : "s"} sent`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
      onDone();
    }
  }

  async function downloadPaper() {
    if (paper.length === 0) return;
    setZipping(true);
    try {
      const res = await fetch(`${api}/runs/${runId}/paper`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donors: paper.map((d) => d.key) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Download failed");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `FF SA USA - ${year} paper statements.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${paper.length} paper statement${paper.length === 1 ? "" : "s"} downloaded and logged`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setZipping(false);
      onDone();
    }
  }

  return (
    <div className="border border-ink">
      <SectionBar title="Send statements" meta={`${sentCount} of ${sendable.length} emailed · ${paper.length} by post`} />
      <div className="space-y-4 p-5">
        {blocker && <p className="text-sm text-amber">{blocker}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => run(notYet, `Send ${year} statements to everyone not yet sent`)} disabled={busy || !!blocker || notYet.length === 0}>
            <Send className="mr-1.5 h-4 w-4" /> Send to everyone not yet sent · {notYet.length}
          </Button>
          <Button
            variant="outline"
            onClick={() => run(picked.filter((d) => !pickedAlready.includes(d)), `Send ${year} statements to the ticked donors`)}
            disabled={busy || !!blocker || picked.length - pickedAlready.length === 0}
          >
            Send to ticked · {picked.length - pickedAlready.length}
          </Button>
          <Button variant="outline" onClick={downloadPaper} disabled={busy || zipping || !!blocker || paper.length === 0}>
            <Download className="mr-1.5 h-4 w-4" />
            {zipping ? "Making PDFs…" : `Paper statements · ${paper.length}`}
          </Button>
        </div>
        {pickedAlready.length > 0 && (
          <p className="text-sm text-amber">
            {pickedAlready.length} ticked donor{pickedAlready.length === 1 ? " has" : "s have"} already been sent {year}&rsquo;s
            statement and will be skipped. To send one again, open them and use Resend.
          </p>
        )}
        {progress && (
          <div className="text-sm">
            Sending {progress.done} of {progress.total}…
            <div className="mt-2 h-1.5 w-full max-w-md bg-rule">
              <div className="h-full bg-ink transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}
        {last && (last.results.some((r) => r.status !== "sent") || last.skipped.length > 0) && (
          <ul className="space-y-1 text-sm">
            {last.results
              .filter((r) => r.status !== "sent")
              .map((r) => (
                <li key={r.key} className="text-destructive">
                  {r.name}: {r.error ?? "failed"}
                </li>
              ))}
            {last.skipped.map((s) => (
              <li key={s.key} className="text-[color:var(--text-tertiary)]">
                {s.name}: skipped — {s.reason}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-[color:var(--text-tertiary)]">
          Each statement is saved and logged when it goes. Donors already emailed {year}&rsquo;s statement are never sent it twice
          by these buttons. Paper statements are for donors without a usable email.
        </p>
      </div>
      <SendLog sends={sends} />
    </div>
  );
}

function SendLog({ sends }: { sends: SendRow[] }) {
  const [all, setAll] = useState(false);
  if (sends.length === 0) return null;
  const shown = all ? sends : sends.slice(0, 15);
  return (
    <div className="border-t border-ink">
      <div className="flex items-center justify-between px-5 py-3">
        <span className="mono-label">Send log · {sends.length}</span>
        {sends.length > 15 && (
          <button type="button" className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:text-electric" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : "Show all"}
          </button>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-rule text-left font-mono text-[9px] uppercase tracking-[0.12em] text-[#7C786C]">
            <th className="px-5 py-1.5">When</th>
            <th>Donor</th>
            <th>To</th>
            <th className="text-right">Total</th>
            <th className="pl-4">Status</th>
            <th className="px-5 text-right">PDF</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className="border-b border-rule last:border-0">
              <td className="px-5 py-1.5 whitespace-nowrap">
                {new Date(r.sent_at ?? r.created_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}
              </td>
              <td>{r.donor_name}</td>
              <td className="text-[color:var(--text-tertiary)]">{r.channel === "paper" ? "Paper (post)" : r.email}</td>
              <td className="text-right">{fmtUsd(r.total_cents)}</td>
              <td className="pl-4">
                <StatusPill tone={r.status === "sent" ? "good" : r.status === "failed" ? "bad" : "warn"}>
                  {r.status === "sent" ? (r.channel === "paper" ? "Downloaded" : r.is_resend ? "Re-sent" : "Sent") : r.status}
                </StatusPill>
                {r.error && <div className="mt-0.5 text-xs text-destructive">{r.error}</div>}
              </td>
              <td className="px-5 text-right">
                {r.pdf_path ? (
                  <a className="inline-flex hover:text-electric" href={`${api}/sends/${r.id}`} title={r.file_name} aria-label={`Download ${r.file_name}`}>
                    <Download className="h-4 w-4" />
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
