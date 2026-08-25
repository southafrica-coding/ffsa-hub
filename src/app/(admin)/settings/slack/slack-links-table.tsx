"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ffsa";

export type SlackLinkRow = {
  id: string;
  name: string;
  email: string | null;
  slackUserId: string | null;
  linkedAt: string | null;
  source: "self" | "admin" | "email_match" | null;
};

const SOURCE_LABEL: Record<string, string> = {
  self: "Self",
  admin: "Admin",
  email_match: "Email match",
};

export function SlackLinksTable({
  rows,
  linkedCount,
}: {
  rows: SlackLinkRow[];
  linkedCount: number;
}) {
  const router = useRouter();
  const [matching, setMatching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const unlinked = rows.length - linkedCount;

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/slack-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function runAutoMatch() {
    setMatching(true);
    setMessage(null);
    setError(null);
    try {
      const data = await post({ action: "auto_match" });
      const r = data.result as {
        attempted: number;
        matched: number;
        notFound: number;
        failed: number;
      };
      setMessage(
        `Checked ${r.attempted} unlinked ${
          r.attempted === 1 ? "person" : "people"
        }: ${r.matched} linked, ${r.notFound} had no matching Slack email, ${
          r.failed
        } failed.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-match failed.");
    } finally {
      setMatching(false);
    }
  }

  async function setManually(userId: string) {
    setBusyId(userId);
    setError(null);
    setMessage(null);
    try {
      const data = await post({ action: "set", userId, memberId: draft });
      setMessage(`Linked to ${data.user?.name ?? "that Slack account"}.`);
      setEditing(null);
      setDraft("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't link.");
    } finally {
      setBusyId(null);
    }
  }

  async function clearLink(userId: string) {
    setBusyId(userId);
    setError(null);
    setMessage(null);
    try {
      await post({ action: "clear", userId });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't unlink.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div className="text-sm">
          <p className="font-medium">
            {linkedCount} of {rows.length} people can be messaged
          </p>
          {unlinked > 0 && (
            <p className="mt-0.5 text-muted-foreground">
              {unlinked} {unlinked === 1 ? "person is" : "people are"} not
              linked and will be skipped by every notification.
            </p>
          )}
        </div>
        <Button onClick={runAutoMatch} disabled={matching}>
          {matching ? "Matching…" : "Match everyone by email"}
        </Button>
      </div>

      {matching && (
        <p className="text-sm text-muted-foreground">
          Checking each unlinked person against Slack, paced to stay inside
          Slack&rsquo;s rate limits. This can take a minute &mdash; leave the
          page open.
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Hub email</th>
              <th className="px-3 py-2 font-medium">Slack</th>
              <th className="px-3 py-2 font-medium">Linked via</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.email ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {row.slackUserId ? (
                    <code className="text-xs">{row.slackUserId}</code>
                  ) : (
                    <StatusPill tone="warn">Not linked</StatusPill>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.source ? SOURCE_LABEL[row.source] ?? row.source : "—"}
                </td>
                <td className="px-3 py-2">
                  {editing === row.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="U01AB2CD3EF"
                        spellCheck={false}
                        className="w-40 rounded-md border bg-background px-2 py-1 font-mono text-xs"
                      />
                      <Button
                        size="sm"
                        onClick={() => setManually(row.id)}
                        disabled={busyId === row.id || !draft.trim()}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(null);
                          setDraft("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(row.id);
                          setDraft("");
                        }}
                      >
                        {row.slackUserId ? "Change" : "Set ID"}
                      </Button>
                      {row.slackUserId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => clearLink(row.id)}
                          disabled={busyId === row.id}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
