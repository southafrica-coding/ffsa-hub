import type { AudienceKey } from "./audiences";

/**
 * Registry of broadcast notification types.
 *
 * A "broadcast" is a DM that goes to EVERYONE — every active Hub user
 * with a linked Slack account, minus whoever muted the module and
 * minus the person who triggered it. It is deliberately the blunt
 * instrument: use it only when an event genuinely affects the whole
 * team and no permission identifies the affected people.
 *
 * Adding a new broadcast is a two-step change:
 *
 *   1. Add an entry to BROADCAST_TYPES below.
 *   2. Call sendBroadcast({ type: "your_key", … }) from the route
 *      that performs the action.
 *
 * Everything else follows automatically — the per-module mute toggle
 * on /profile is rendered straight off this registry, so a new type
 * becomes mutable the moment it is declared.
 *
 * A WORD OF CAUTION before you add one: broadcast DMs are how a bot
 * gets muted. Every entry here costs a little of everyone's
 * attention, and the cost is paid by all ~60 people whether or not
 * the message was relevant to them. If a permission can identify who
 * actually cares, prefer a scoped notification instead.
 */

/** Module keys group broadcast types for the per-module mute toggle. */
export const BROADCAST_MODULES = {
  prayer_room: {
    label: "Prayer Room",
    description:
      "Block-outs and devo set relocations that affect the whole roster.",
  },
} as const;

export type BroadcastModule = keyof typeof BROADCAST_MODULES;

export type BroadcastType = {
  /** Stable key; stored on notifications.event_type. */
  key: string;
  module: BroadcastModule;
  /**
   * Who this goes to. Resolved at send time by
   * src/lib/slack/audiences.ts — always a query over real membership
   * or permissions, never a maintained list.
   *
   * Reach for "everyone" sparingly: it means all ~165 Hub accounts,
   * students and community included, most of whom have no stake in
   * any one module.
   */
  audience: AudienceKey;
  /** Shown in the preferences UI. */
  label: string;
  description: string;
};

export const BROADCAST_TYPES: BroadcastType[] = [
  {
    key: "prayer_room_blockout",
    module: "prayer_room",
    audience: "prayer_room",
    label: "Prayer room block-out",
    description:
      "A manager has blocked out a time and devo sets have had to move.",
  },
];

export function findBroadcastType(key: string): BroadcastType | null {
  return BROADCAST_TYPES.find((t) => t.key === key) ?? null;
}

/** Modules that actually have at least one broadcast type today. */
export function activeBroadcastModules(): Array<{
  key: BroadcastModule;
  label: string;
  description: string;
  types: BroadcastType[];
}> {
  return (Object.keys(BROADCAST_MODULES) as BroadcastModule[])
    .map((key) => ({
      key,
      label: BROADCAST_MODULES[key].label,
      description: BROADCAST_MODULES[key].description,
      types: BROADCAST_TYPES.filter((t) => t.module === key),
    }))
    .filter((m) => m.types.length > 0);
}
