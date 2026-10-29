"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

// Slack channel ids: C… (public) or G… (older private channels).
const CHANNEL_ID = /^[CG][A-Z0-9]{8,}$/;

/**
 * Lets the team ask the Slack bot about this budget — by DM, or by
 * @mentioning it in the team's channel. Off until switched on, so teams
 * can be rolled out one at a time.
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
          The owner and co-leaders can ask the <strong>Outreach Finance</strong> Slack bot about this budget (&ldquo;how
          much is left in food?&rdquo;) by DM, or by @mentioning it in the team&apos;s channel. They need their Slack
          linked on their Hub profile. Team members can&apos;t see the budget, so the bot won&apos;t answer them.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        Answer this team&apos;s budget questions in Slack
      </label>

      <div className="grid gap-1.5 sm:max-w-md">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#55524A]">
          Team channel ID (optional)
        </span>
        <Input
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="e.g. C07ABC12345"
          aria-label="Team Slack channel ID"
          className={`h-9 font-mono ${invalid ? "border-destructive" : ""}`}
        />
        <span className="text-xs text-muted-foreground">
          In Slack, type <code>/invite @Outreach Finance</code> in the channel and @mention it — it replies with the
          channel ID to paste here. Or open the channel name → the ID is at the bottom.
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
