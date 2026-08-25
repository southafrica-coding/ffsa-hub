"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// Dashboard nudge for anyone without a linked Slack account.
//
// Deliberately dismissible rather than a blocking gate: the
// ProfileCompletionGate exists for compliance items (passport, visa,
// insurance, consent), and locking someone out of the whole Hub over
// a notification preference is out of proportion. Dismissal is
// per-browser via localStorage — losing it on a new device is fine,
// since a re-nudge is exactly what we'd want anyway. The admin
// coverage page at /settings/slack is the real chase list.

const DISMISS_KEY = "ffsa.slack-connect-banner.dismissed";

export function SlackConnectBanner({ show }: { show: boolean }) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  });

  if (!show || dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private browsing / storage disabled — dismissing for this
      // session only is an acceptable fallback.
    }
    setDismissed(true);
  }

  return (
    <div className="mx-5 mb-4 rounded-xl border bg-muted/40 p-4 text-sm md:mx-8">
      <p className="font-medium">Connect Slack to get Hub notifications</p>
      <p className="mt-1 text-muted-foreground">
        The Hub messages you directly in Slack when something happens that
        affects you &mdash; like a prayer room block-out that moves a devo set.
        You&rsquo;re not receiving any of them yet. It takes about a minute.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button asChild size="sm">
          <Link href="/profile#notifications">Connect Slack</Link>
        </Button>
        <Button variant="outline" size="sm" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
