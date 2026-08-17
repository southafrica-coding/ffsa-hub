"use client";

/**
 * The module's masthead + tab strip.
 *
 * Frames 10a and 12a both draw the header as part of the screen — the context
 * line, the actions and the filter chips all change with the tab. So each tab
 * renders this itself rather than the shell guessing on its behalf. Only one
 * tab is ever mounted, so the "one Masthead per screen" rule still holds.
 */

import { Masthead, ModuleTabs } from "@/components/ffsa";

export type TabKey = "week" | "day" | "people" | "evaluators" | "mine" | "join" | "manage";

export type TabDef = { key: TabKey; label: string; mark?: boolean };

export default function PrayerRoomChrome({
  context,
  actions,
  tabs,
  active,
  onChange,
  trailing,
}: {
  context: string;
  actions?: React.ReactNode;
  tabs: TabDef[];
  active: TabKey;
  onChange: (key: TabKey) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <>
      <Masthead context={context} title="Prayer Room" actions={actions} />
      <ModuleTabs
        tabs={tabs}
        active={active}
        onChange={(k) => onChange(k as TabKey)}
        trailing={trailing}
      />
    </>
  );
}
