// The door's answer card (mockup 5.13). Every variant is checked by its icon
// AND its words, then by its shape (fill / heavy outline / dashed), in light
// and dark: nobody at a door should have to tell colours apart.

import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { ApiError } from "@/lib/api";
import { colors } from "@/theme/tokens";

import { VerdictCard, verdictLook } from "../components/VerdictCard";
import { verdictFromError, verdictFromOutcome, verdictNotATicket, verdictQueued, verdictUndone, type Verdict } from "../result";
import { strings } from "../strings";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});

const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;

const ok = verdictFromOutcome({ result: "ok", ticketId: "t1", ticketTypeName: "Adult", buyerName: "Sample Person 922" });
const already = verdictFromOutcome({ result: "already_checked_in", ticketTypeName: "Adult", checkedInAt: "2026-11-03T16:05:00.000Z" });

type Case = { name: string; verdict: Verdict; look: string; icon: string; words: RegExp; detail?: RegExp };

const CASES: Case[] = [
  { name: "checked in", verdict: ok, look: "admit", icon: "check", words: /^Checked in$/, detail: /Sample Person 922 · Adult/ },
  { name: "already checked in", verdict: already, look: "already", icon: "repeat", words: /^Already checked in at \d\d:\d\d$/, detail: /Adult/ },
  {
    name: "wrong event",
    verdict: verdictFromOutcome({ result: "wrong_event" }),
    look: "reject",
    icon: "stop",
    words: /^Not a ticket for this event$/,
    detail: /different event/,
  },
  { name: "no ticket matches", verdict: verdictFromOutcome({ result: "invalid" }), look: "reject", icon: "stop", words: /^Not a ticket$/, detail: /No ticket matches/ },
  { name: "not an FFSA QR", verdict: verdictNotATicket(), look: "reject", icon: "stop", words: /^Not a ticket$/, detail: /isn't an FFSA ticket/ },
  { name: "cancelled", verdict: verdictFromOutcome({ result: "void" }), look: "reject", icon: "stop", words: /^Ticket cancelled$/, detail: /cancelled or refunded/ },
  { name: "saved, not confirmed", verdict: verdictQueued(), look: "queued", icon: "clock", words: /^Saved, not yet confirmed$/, detail: /NOT confirmed/ },
  {
    name: "needs attention",
    verdict: verdictFromError(new ApiError("http", "Something went wrong on the server (500). Try again.", 500)),
    look: "attention",
    icon: "alert",
    words: /^Needs attention$/,
    detail: /Try again/,
  },
  {
    name: "undo failed",
    verdict: verdictFromError(new ApiError("network", "No connection. Try again, or find the guest by name."), strings.result.undoFailed),
    look: "attention",
    icon: "alert",
    words: /^Couldn't undo that check-in\.$/,
    detail: /No connection/,
  },
  { name: "check-in undone", verdict: verdictUndone(), look: "attention", icon: "alert", words: /^Check-in undone$/ },
];

function show(verdict: Verdict, props: Partial<Parameters<typeof VerdictCard>[0]> = {}) {
  return render(<VerdictCard verdict={verdict} undoOpen onUndo={jest.fn()} onDismiss={jest.fn()} {...props} />);
}

beforeEach(() => {
  mockScheme = "light";
});

describe.each(["light", "dark"] as const)("VerdictCard (%s)", (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });
  const c = colors[scheme];

  it.each(CASES)("$name: its own icon and words", async ({ verdict, look, icon, words, detail }) => {
    await show(verdict);
    expect(verdictLook(verdict)).toBe(look);
    // The icon is there (and hidden from screen readers: the words say it).
    const iconBox = screen.getByTestId(`verdict-icon-${icon}`, { includeHiddenElements: true });
    expect(iconBox.props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByTestId("verdict-title")).toHaveTextContent(words);
    if (detail) expect(screen.getByTestId("verdict-detail")).toHaveTextContent(detail);
    else expect(screen.queryByTestId("verdict-detail")).toBeNull();
    // Spoken as one alert: the title, then the detail.
    expect(screen.getByRole("alert")).toHaveTextContent(new RegExp(words.source.replace(/^\^/, "").replace(/\$$/, "")));
    expect(screen.getByTestId("verdict").props.accessibilityLiveRegion).toBe("assertive");
  });

  it("checked in is the only filled card: green, no outline, label in the on-green colour", async () => {
    await show(ok);
    const card = flat(screen.getByTestId("verdict").props.style);
    expect(card).toMatchObject({ backgroundColor: c.positive, borderWidth: 0, borderRadius: 8 });
    expect(flat(screen.getByTestId("verdict-title").props.style).color).toBe(c.onPositive);
    expect(c.onPositive).toBe(scheme === "light" ? "#FFFFFF" : "#0A0A0A");
  });

  it("already checked in: a heavy amber outline, never a fill", async () => {
    await show(already);
    expect(flat(screen.getByTestId("verdict").props.style)).toMatchObject({
      backgroundColor: c.raised,
      borderColor: c.attention,
      borderWidth: 4,
      borderStyle: "solid",
    });
  });

  it.each(["wrong_event", "invalid", "void"] as const)("%s: a heavy red outline", async (result) => {
    await show(verdictFromOutcome({ result }));
    expect(flat(screen.getByTestId("verdict").props.style)).toMatchObject({ borderColor: c.danger, borderWidth: 4, borderStyle: "solid" });
  });

  it("saved offline is dashed and never green", async () => {
    await show(verdictQueued());
    const card = flat(screen.getByTestId("verdict").props.style);
    expect(card).toMatchObject({ borderStyle: "dashed", borderWidth: 4, borderColor: c.text });
    expect(card.backgroundColor).not.toBe(c.positive);
  });

  it("needs attention / undone: a heavy ink outline", async () => {
    await show(verdictUndone());
    expect(flat(screen.getByTestId("verdict").props.style)).toMatchObject({ borderColor: c.text, borderWidth: 4, borderStyle: "solid" });
  });
});

describe("VerdictCard actions", () => {
  it("Undo only on a confirmed check-in, and only while its window is open", async () => {
    const onUndo = jest.fn();
    const view = await show(ok, { onUndo });
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo.props.accessibilityHint).toBe("Reverses this check-in");
    await fireEvent.press(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);

    await view.rerender(<VerdictCard verdict={ok} undoOpen={false} onUndo={onUndo} onDismiss={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it.each(CASES.filter((c) => c.look !== "admit"))("$name: no Undo", async ({ verdict }) => {
    await show(verdict);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Dismiss on the page, Scan next over the camera; buttons are 44pt+", async () => {
    const onDismiss = jest.fn();
    const view = await show(already, { onDismiss });
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    expect(flat(dismiss.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await view.rerender(<VerdictCard verdict={already} undoOpen onUndo={jest.fn()} onDismiss={onDismiss} dismissLabel="Scan next" />);
    expect(screen.getByRole("button", { name: "Scan next" })).toBeTruthy();
  });
});
