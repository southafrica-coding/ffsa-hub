import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  REMINDER_COOLDOWN_MS,
  gateManualReminder,
  lastReminderLabel,
  remindAllToast,
} from "./manual-reminder";
import { LastReminderSent } from "./last-reminder-sent";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-10T12:00:00.000Z");

describe("manual reminder gate", () => {
  it("refuses a submitted reference", () => {
    const gate = gateManualReminder({
      status: "submitted",
      reminderSentAt: null,
      now: NOW,
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.status).toBe(409);
  });

  it("refuses a reminder inside the 24 hour window", () => {
    const gate = gateManualReminder({
      status: "pending",
      reminderSentAt: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
      now: NOW,
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.status).toBe(429);
    expect(gate.error).toMatch(/21 hours/);
    expect(gate.retryAfterSeconds).toBe(Math.ceil((21 * HOUR) / 1000));
  });

  it("allows a reminder once 24 hours have passed", () => {
    expect(
      gateManualReminder({
        status: "pending",
        reminderSentAt: new Date(NOW.getTime() - REMINDER_COOLDOWN_MS).toISOString(),
        now: NOW,
      }).ok
    ).toBe(true);
  });
});

describe("remind-all summary", () => {
  it("names cooldown, a finished reference, or an error when nothing was sent", () => {
    expect(remindAllToast([{ outcome: "cooldown", error: "You can send another in 5 hours." }])).toEqual({
      tone: "error",
      text: "No reminders were sent. You can send another in 5 hours.",
    });
    expect(remindAllToast([{ outcome: "not_outstanding" }])).toEqual({
      tone: "error",
      text: "No reminders were sent. Every reference has already been submitted.",
    });
    expect(remindAllToast([{ outcome: "error", error: "Could not claim this reminder." }])).toEqual({
      tone: "error",
      text: "No reminders were sent. Could not claim this reminder.",
    });
    expect(remindAllToast([{ outcome: "sent" }, { outcome: "cooldown" }]).tone).toBe("ok");
  });
});

describe("last reminder display", () => {
  it("says when the last reminder was sent, relative to now", () => {
    const sentAt = new Date(NOW.getTime() - 3 * HOUR).toISOString();
    expect(lastReminderLabel(sentAt, NOW.getTime())).toBe("Last reminder sent 3 hours ago");
    expect(lastReminderLabel(null, NOW.getTime())).toBeNull();
  });

  it("renders that sentence and nothing when no reminder has been sent", () => {
    const sentAt = new Date(NOW.getTime() - 3 * HOUR).toISOString();
    const shown = renderToStaticMarkup(
      createElement(LastReminderSent, { sentAt, nowMs: NOW.getTime() })
    );
    expect(shown).toContain("Last reminder sent 3 hours ago");
    const empty = renderToStaticMarkup(
      createElement(LastReminderSent, { sentAt: null, nowMs: NOW.getTime() })
    );
    expect(empty).toBe("");
  });
});
