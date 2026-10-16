"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROFILE_TABS, type ProfileTab } from "./profile-tab-keys";

// The /profile page split into tabs. Content is rendered on the server and
// handed in as nodes, so this only owns which tab is showing. The choice is
// mirrored to ?tab= with replaceState (no navigation), so a link like
// /profile?tab=work lands on that tab and a router.refresh() — after a save,
// or the portal's 10s AutoRefresh — keeps it.


const LABELS: Record<ProfileTab, string> = {
  personal: "Personal",
  work: "Work",
  slack: "Slack",
  legal: "Legal",
  records: "Records",
};

export function ProfileTabs({
  initialTab,
  personal,
  work,
  slack,
  legal,
  records,
  personalNeedsAttention = false,
}: {
  initialTab: ProfileTab;
  personal: ReactNode;
  /** Omitted for students and community members — no Work tab. */
  work?: ReactNode;
  slack: ReactNode;
  legal: ReactNode;
  records: ReactNode;
  /** Required profile details are missing — mark the Personal tab. */
  personalNeedsAttention?: boolean;
}) {
  const content: Partial<Record<ProfileTab, ReactNode>> = {
    personal,
    work,
    slack,
    legal,
    records,
  };
  const tabs = PROFILE_TABS.filter((t) => content[t] !== undefined);
  const [tab, setTab] = useState<ProfileTab>(
    tabs.includes(initialTab) ? initialTab : "personal"
  );

  function select(value: string) {
    const next = value as ProfileTab;
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === "personal") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // URL sync is a convenience only.
    }
  }

  return (
    <Tabs value={tab} onValueChange={select}>
      <div className="border-b border-ink bg-white">
        <TabsList className="flex h-auto w-full justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0 px-5 md:px-8">
          {tabs.map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="relative shrink-0 rounded-none border-b-[3px] border-transparent min-h-11 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)] data-[state=active]:border-ink data-[state=active]:bg-transparent data-[state=active]:text-ink data-[state=active]:shadow-none"
            >
              {LABELS[t]}
              {t === "personal" && personalNeedsAttention && (
                <span
                  aria-label="Details missing"
                  className="ml-1.5 inline-block h-1.5 w-1.5 bg-[#8A6400]"
                />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((t) => (
        <TabsContent key={t} value={t} className="mt-0">
          {content[t]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
