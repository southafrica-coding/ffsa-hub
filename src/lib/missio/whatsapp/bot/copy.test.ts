import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { messageBody } from "../graph";
import * as copy from "./copy";
import { FALLBACK_TEAM_LIST } from "./engine";
import {
  addedMessage,
  availabilityMessage,
  experienceMessage,
  firstTeamsMessage,
  interactiveProblem,
  otherTeamMessage,
  readableBody,
  thanksMessage,
  welcomeMessage,
  withFallback,
  withHumanFirst,
} from "./messages";

describe("menu copy", () => {
  it("pins the welcome, hand-off, fallback and serving words", () => {
    expect(copy.WELCOME).toBe(
      "Hi, it’s Missio. Thanks for writing — we’re glad you’re here.\n\n" +
        "Pastors can see this chat in our Hub so they can help you. Reply STOP at any time if you don’t want messages from this number.\n\n" +
        "How can we help?"
    );
    expect(copy.MAIN_MENU).toEqual([
      { id: "new", title: "I’m new here", description: "First time, or coming back" },
      { id: "house", title: "Find a house church", description: "A midweek home group" },
      { id: "serve", title: "I want to serve", description: "Join a Sunday team" },
      { id: "care", title: "Prayer or care", description: "A pastor will take this chat" },
      { id: "feedback", title: "Weekly feedback", description: "For house church leaders" },
      { id: "human", title: "Talk to a person", description: "A pastor will reply" },
    ]);
    expect(copy.HANDOFF_HUMAN).toBe("Of course. A pastor will take this chat from here. You can keep writing — the menu will stay quiet.");
    expect(copy.HANDOFF_DEFERRED).toBe("Thanks. A pastor will take this and help you with that. You can keep writing — the menu will stay quiet.");
    expect(copy.FALLBACK).toBe("I didn’t catch that. You can pick from the menu, or type “talk to a person” and a pastor will take over.");
    expect(copy.SERVE_TEAMS).toBe("We’d love to have you serve with us. Which team interests you? Pick one or more, then tap Done.");
    expect(copy.SERVE_AVAILABILITY).toBe("How often could you help?");
    expect(copy.AVAILABILITY.map((a) => a.title)).toEqual(["Most Sundays", "Once or twice a month", "Midweek or once-off", "Not sure yet"]);
    expect(copy.SERVE_EXPERIENCE).toBe("Have you served on a church team before?");
    expect(copy.EXPERIENCE.map((e) => e.title)).toEqual(["Yes", "A little", "Not yet"]);
    expect(copy.FALLBACK_TEAMS.map((t) => t.name)).toEqual(["Welcome", "Worship / band", "Kids", "Hospitality", "Production / tech", "Prayer"]);
    expect(copy.serveThanks(null, ["Kids"])).toBe(
      "Thank you. We’ve noted your interest in Kids and let the team leader know. They’ll follow up.\n\n" +
        "If you want to add a note — experience, times that work, anything else — send it now, or tap Done."
    );
    expect(copy.teamList(["Kids", "Welcome", "Prayer"])).toBe("Kids, Welcome and Prayer");
    expect(copy.SERVE_CLOSE).toBe("Thank you. If you need anything else, type menu.");
  });

  it("has no emoji and no chatbot wording", () => {
    const all = JSON.stringify(copy);
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(all.toLowerCase()).not.toMatch(/\bbot\b.*(here|helper)|chatbot|assistant|virtual/);
    // The person never reads "bot": only the pastor-facing status lines say it.
    const personFacing = [copy.WELCOME, copy.HANDOFF_HUMAN, copy.HANDOFF_DEFERRED, copy.FALLBACK, copy.SERVE_TEAMS, copy.SERVE_CLOSE].join(" ");
    expect(personFacing.toLowerCase()).not.toContain("bot");
  });

  it("every menu message fits WhatsApp's limits", () => {
    const longTeams = Array.from({ length: 13 }, (_, i) => ({ id: `id-${i}`, name: `A team with a much longer name than fits ${i}` }));
    const messages = [
      welcomeMessage(),
      withFallback(welcomeMessage()),
      withHumanFirst(withFallback(welcomeMessage())),
      firstTeamsMessage(FALLBACK_TEAM_LIST),
      firstTeamsMessage(longTeams),
      firstTeamsMessage(longTeams, [], 1),
      withHumanFirst(firstTeamsMessage(longTeams)),
      otherTeamMessage(),
      withHumanFirst(otherTeamMessage()),
      addedMessage("Production / tech"),
      withHumanFirst(addedMessage("Kids")),
      availabilityMessage(),
      experienceMessage(),
      withHumanFirst(experienceMessage()),
      thanksMessage("Sam", ["Kids", "Welcome"]),
      thanksMessage(null, longTeams.map((t) => t.name)),
    ];
    for (const message of messages) expect(interactiveProblem(message), JSON.stringify(message)).toBeNull();
  });

  it("refuses a malformed message", () => {
    expect(interactiveProblem({ kind: "buttons", body: "x", buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: "ok" })) })).toBe("1–3 buttons");
    expect(interactiveProblem({ kind: "buttons", body: "x", buttons: [{ id: "a", title: "A title far longer than twenty" }] })).toMatch(/button title/);
    expect(interactiveProblem({ kind: "list", body: "x", button: "Choose", rows: Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, title: "t" })) })).toBe("1–10 rows");
    expect(interactiveProblem({ kind: "list", body: "x", button: "Choose", rows: [{ id: "a", title: "t" }, { id: "a", title: "u" }] })).toMatch(/row id/);
  });

  it("reads naturally in the pastor's thread", () => {
    expect(readableBody(experienceMessage())).toBe("Have you served on a church team before?\n\nChoices: Yes · A little · Not yet");
  });

  it("pastor-facing status lines", () => {
    expect(copy.botStatusLine({ mode: "on", reason: null, flow: "serve", step: "teams" })).toBe("Bot is asking which team");
    expect(copy.botStatusLine({ mode: "paused", reason: "pastor", flow: null, step: null })).toBe("A pastor has this chat. The bot is quiet.");
    expect(copy.botStatusLine({ mode: "handed_off", reason: "human", flow: null, step: null })).toBe("They asked for a person. A pastor has this chat.");
    expect(copy.botStatusLine({ mode: "on", reason: null, flow: "rest", step: "done" })).toBe("Bot is on. It answers new messages with the menu.");
  });
});

describe("Graph interactive payloads", () => {
  it("builds reply buttons", () => {
    expect(messageBody({ kind: "buttons", to: "+27820000001", body: "Pick", buttons: [{ id: "a", title: "A" }] })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+27820000001",
      type: "interactive",
      interactive: { type: "button", body: { text: "Pick" }, action: { buttons: [{ type: "reply", reply: { id: "a", title: "A" } }] } },
    });
  });

  it("builds a list", () => {
    expect(
      messageBody({ kind: "list", to: "+27820000001", body: "Pick", button: "Choose", rows: [{ id: "a", title: "A", description: "about a" }, { id: "b", title: "B" }] })
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+27820000001",
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Pick" },
        action: { button: "Choose", sections: [{ rows: [{ id: "a", title: "A", description: "about a" }, { id: "b", title: "B" }] }] },
      },
    });
  });
});

describe("the bot never creates people", () => {
  it("no bot file touches org_people, and the store never inserts a contact", () => {
    const dir = __dirname;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(/org_people|house_church_members|connect_responses/);
    }
    const store = readFileSync(path.join(dir, "../supabase-store.ts"), "utf8");
    expect(store).not.toMatch(/from\("(contacts|org_people|contact_phones)"\)\s*\.(insert|upsert|update|delete)/);
  });
});
