"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Links this account to a Slack member id so the Hub can DM the
// person directly instead of posting to yet another group channel.
//
// Most people arrive here already linked — an admin runs the email
// auto-match and it fills in silently. This card is for the rest,
// which is why the instructions are spelled out step by step rather
// than assuming anyone knows what a "member ID" is. The mobile path
// is different enough from desktop to be worth its own line; people
// on phones otherwise hunt for a ⋮ that isn't there.

type Props = {
  slackUserId: string | null;
  linkedAt: string | null;
  source: "self" | "admin" | "email_match" | null;
};

function sourceLabel(source: Props["source"]): string {
  if (source === "email_match") return "matched automatically from your email address";
  if (source === "admin") return "set up by an admin";
  return "entered by you";
}

export function SlackLinkCard({ slackUserId, linkedAt, source }: Props) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [matchedName, setMatchedName] = useState<string | null>(null);

  async function link() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't link your Slack account.");
        return;
      }
      // Echo the matched name back — a mistyped id is a valid-looking
      // string, and this is the only moment it's catchable.
      setMatchedName(data.user?.name ?? null);
      setValue("");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/slack", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't unlink. Please try again.");
        return;
      }
      setConfirmingUnlink(false);
      setMatchedName(null);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (slackUserId) {
    return (
      <div className="rounded-xl border bg-muted/40 p-4 text-sm">
        <p className="font-medium">Slack connected</p>
        <p className="mt-1 text-muted-foreground">
          The Hub will send you a direct message when something happens that
          you need to know about &mdash; no group channels. Your member ID is{" "}
          <code className="rounded bg-background px-1 py-0.5">{slackUserId}</code>
          , {sourceLabel(source)}
          {linkedAt
            ? ` on ${new Date(linkedAt).toLocaleDateString("en-ZA", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}`
            : ""}
          .
        </p>
        {matchedName && (
          <p className="mt-2 text-muted-foreground">
            Linked to <span className="font-medium">{matchedName}</span> in
            Slack. If that isn&rsquo;t you, disconnect below and try again.
          </p>
        )}
        {error && <p className="mt-2 text-destructive">{error}</p>}

        {confirmingUnlink ? (
          <div className="mt-3 space-y-3">
            <p className="text-muted-foreground">
              If you disconnect, you&rsquo;ll stop receiving Hub messages in
              Slack entirely &mdash; including prayer room block-outs that
              affect everyone. To quieten just one area, use the notification
              settings below instead. Are you sure?
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="destructive"
                size="sm"
                onClick={unlink}
                disabled={saving}
              >
                Yes, disconnect Slack
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingUnlink(false)}
                disabled={saving}
              >
                Keep it connected
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setConfirmingUnlink(true)}
          >
            That isn&rsquo;t me / disconnect
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-muted/40 p-4 text-sm">
      <p className="font-medium">Connect Slack to get personal notifications</p>
      <p className="mt-1 text-muted-foreground">
        The Hub sends you a direct message when something happens that affects
        you &mdash; like a prayer room block-out that moves a devo set. Until
        you connect Slack, you won&rsquo;t receive any of them.
      </p>

      <div className="mt-4 rounded-lg border bg-background p-3">
        <p className="font-medium">Finding your Slack member ID</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Open Slack and click your profile picture, top right.</li>
          <li>
            Choose <span className="font-medium">Profile</span>.
          </li>
          <li>
            On desktop, click the <span className="font-medium">⋮</span> (More)
            button under your name. On mobile, scroll to the bottom of your
            profile.
          </li>
          <li>
            Tap <span className="font-medium">Copy member ID</span>.
          </li>
          <li>Paste it below.</li>
        </ol>
        <p className="mt-2 text-muted-foreground">
          It looks like <code className="rounded bg-muted px-1 py-0.5">U01AB2CD3EF</code>{" "}
          &mdash; always starting with a U. This is not your @handle or your
          email address.
        </p>
      </div>

      {error && <p className="mt-3 text-destructive">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="U01AB2CD3EF"
          spellCheck={false}
          autoCapitalize="characters"
          className="w-56 rounded-md border bg-background px-3 py-2 font-mono text-sm"
        />
        <Button size="sm" onClick={link} disabled={saving || !value.trim()}>
          {saving ? "Checking…" : "Connect Slack"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        We&rsquo;ll check the ID against the FFSA workspace and show you whose
        account it is before anything is sent.
      </p>
    </div>
  );
}
