"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

// Channel ids start with C or G. A public channel and a private one can
// look the same from here — the bot decides. This field is for a private
// channel the bot is already in. Receipts are not taken in a public channel.
const CHANNEL_ID = /^[CG][A-Z0-9]{8,}$/;

/**
 * Budget questions: DM the bot, or @mention it (including in a public
 * channel). Receipts: DM the bot, or a private channel it is already in.
 * Off until switched on, so teams can be rolled out one at a time.
 */
export function SlackSettings({
  teamId,
  enabled: initialEnabled,
  channelId: initialChannel,
}: {
  teamId: string;
  enabled: boolean;
  channelId: string | null;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [channel, setChannel] = useState(initialChannel ?? "");
  const [saving, setSaving] = useState(false);

  const trimmed = channel.trim().toUpperCase();
  const invalid = trimmed !== "" && !CHANNEL_ID.test(trimmed);
  const dirty = enabled !== initialEnabled || trimmed !== (initialChannel ?? "");

  async function save() {
    if (invalid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/finance/outreach/teams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: teamId, slack_enabled: enabled, slack_channel_id: trimmed || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          /uq_outreach_teams_slack_channel|duplicate key/i.test(data.error ?? "")
            ? "That channel is already linked to another team"
            : data.error || "Couldn't save the Slack settings"
        );
        return;
      }
      toast.success("Slack settings saved");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 border border-ink px-4 py-4">
      <div>
        <h3 className="font-medium">Slack</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          DM the bot, or paste a private channel id. The owner and co-leaders can ask the{" "}
          <strong>Outreach Finance</strong> bot about this budget (&ldquo;how much is left in food?&rdquo;) by DM, or
          by @mentioning it. A budget question in a public channel can still work by @mention. Receipts cannot use a
          public channel. Receipts are only taken in a DM with the bot, or in a private channel the bot is already
          in — not a public channel, a group DM, or a channel it hasn&apos;t joined. They need their Slack linked on
          their Hub profile. Team members can&apos;t see the budget, so the bot won&apos;t answer them.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        Answer this team&apos;s budget questions in Slack
      </label>

      <div className="grid gap-1.5 sm:max-w-md">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#55524A]">
          Private channel ID (optional)
        </span>
        <Input
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="Private channel ID"
          aria-label="Private Slack channel ID"
          className={`h-9 font-mono ${invalid ? "border-destructive" : ""}`}
        />
        <span className="text-xs text-muted-foreground">
          DM the bot, or paste a private channel id. Open the private channel the bot is already in — the ID is at
          the bottom of the channel details. A public channel id will not take receipts.
        </span>
        {invalid && <span className="text-xs text-destructive">That doesn&apos;t look like a Slack channel ID.</span>}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!dirty || saving || invalid}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
