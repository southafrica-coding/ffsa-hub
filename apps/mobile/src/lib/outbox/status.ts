// What an outbox item's state means to the person, in words. Pure.

import { MAX_ATTEMPTS } from "./backoff";
import type { BaseItem } from "./queue";
import { outboxStrings as s } from "./strings";

export type ItemState = "offline" | "waiting" | "sending" | "needs_you";

export function itemState(item: Pick<BaseItem, "status">, online: boolean): ItemState {
  if (item.status === "failed") return "needs_you";
  if (item.status === "sending") return "sending";
  return online ? "waiting" : "offline";
}

const LABEL: Record<ItemState, string> = {
  offline: s.state.offline,
  waiting: s.state.waiting,
  sending: s.state.sending,
  needs_you: s.state.needsYou,
};

export function stateLabel(state: ItemState): string {
  return LABEL[state];
}

/** The reason (for "needs you", always with a next step) or what happens next. */
export function stateDetail(item: Pick<BaseItem, "status" | "lastError" | "attempts">, online: boolean): string {
  const state = itemState(item, online);
  if (state === "needs_you") {
    const reason = item.lastError ?? "";
    const gaveUp = item.attempts >= MAX_ATTEMPTS ? s.gaveUp : s.next.needsYou;
    return reason ? `${reason} ${gaveUp}` : gaveUp;
  }
  if (state === "offline") return s.next.offline;
  if (state === "sending") return s.next.sending;
  return item.lastError ? `${item.lastError} ${s.next.waiting}` : s.next.waiting;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14:05" today, "3 Nov, 14:05" otherwise (phone's local time). */
export function formatWhen(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? clock : `${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock}`;
}

export function lastTriedText(item: Pick<BaseItem, "lastTriedAt">, now: number): string | null {
  return item.lastTriedAt ? s.lastTried(formatWhen(item.lastTriedAt, now)) : null;
}

export function countStates(items: Pick<BaseItem, "status">[]): { waiting: number; needsYou: number } {
  let waiting = 0;
  let needsYou = 0;
  for (const i of items) {
    if (i.status === "failed") needsYou++;
    else waiting++;
  }
  return { waiting, needsYou };
}

/** "2 waiting · 1 needs you", or "" when empty. */
export function summaryText(items: Pick<BaseItem, "status">[]): string {
  const c = countStates(items);
  return s.summary(c.waiting, c.needsYou);
}

/** One sentence for screen readers: state, reason/next step, last tried. */
export function statusSentence(item: Pick<BaseItem, "status" | "lastError" | "attempts" | "lastTriedAt">, online: boolean, now: number): string {
  const parts = [stateLabel(itemState(item, online)), stateDetail(item, online), lastTriedText(item, now)];
  return parts.filter(Boolean).join(". ").replace(/\.\./g, ".");
}
