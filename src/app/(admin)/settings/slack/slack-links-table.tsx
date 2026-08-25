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

// Slack error codes → what to actually do about them. Without this the
// page can only say "N failed", which looks like a data problem when
// it is almost always a one-line config fix.
const ERROR_HELP: Record<string, string> = {
  invalid_arguments:
    "Slack couldn't read the request. This was a Hub bug — the users.* lookups were being sent as JSON when Slack only accepts form encoding for them. Fixed; if you still see this, something else is malformed.",
  missing_scope:
    "The Slack app is missing a permission it needs. Its scopes look right in the config, but the bot token predates them — go to api.slack.com/apps → FFSA Hub Activity → OAuth & Permissions and click Reinstall to Workspace, then try again.",
  not_allowed_token_type:
    "The token in SLACK_BOT_TOKEN isn't a bot token. It should start with xoxb-.",
  invalid_auth:
    "Slack rejected the token. Check SLACK_BOT_TOKEN in the Vercel project env (Production and Preview) and redeploy.",
  account_inactive:
    "The Slack app's token has been deactivated. Reinstall the app to the workspace.",
  token_revoked:
    "The Slack token has been revoked. Reinstall the app to the workspace and update SLACK_BOT_TOKEN.",
  ratelimited:
    "Slack rate-limited the run. Wait a minute and click the button again — it only fills gaps, so re-running is safe.",
  no_bot_token:
    "SLACK_BOT_TOKEN isn't set in this environment, so nothing was sent to Slack at all.",
  already_linked_to_another_user:
    "That Slack account is already linked to a different Hub profile.",
  db_write_failed: "The match succeeded but saving it to the Hub failed.",
  aborted_after_repeated_failures:
    "Stopped early: every call was failing, so the run was cut short rather than repeating a call that can't succeed.",
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
  const [errorCodes, setErrorCodes] = useState<Record<string, number>>({});
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
    setErrorCodes({});
    try {
      const data = await post({ action: "auto_match" });
      const r = data.result as {
        attempted: number;
        matched: number;
        notFound: number;
        failed: number;
        errors?: Record<string, number>;
      };
      setErrorCodes(r.errors ?? {});
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
          Checking each unlinked person against Slack, paced at roughly one
          per 1.3 seconds to stay inside Slack&rsquo;s rate limits. With a
          few hundred people that is several minutes &mdash; leave the page
          open. If it&rsquo;s clearly broken it stops early rather than
          grinding through them all.
        </p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {Object.keys(errorCodes).length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Why the matching failed</p>
          <ul className="mt-2 space-y-2">
            {Object.entries(errorCodes).map(([code, count]) => (
              <li key={code}>
                <code className="text-xs">{code}</code>
                <span className="text-muted-foreground"> &times; {count}</span>
                {ERROR_HELP[code] && (
                  <p className="mt-0.5 text-muted-foreground">
                    {ERROR_HELP[code]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
