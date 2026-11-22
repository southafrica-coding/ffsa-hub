import { describe, expect, it } from "vitest";
import { outreachEventKind } from "./event-gate";

describe("outreachEventKind", () => {
  it("treats a DM as a turn and ignores the duplicate mention in that DM", () => {
    expect(outreachEventKind({ type: "message", channel_type: "im", channel: "D123" })).toBe("dm");
    expect(outreachEventKind({ type: "app_mention", channel: "D123", channel_type: "im" })).toBe("ignore");
  });

  it("mention-gates channels and does not also handle message.groups", () => {
    expect(outreachEventKind({ type: "app_mention", channel: "G123", channel_type: "group" })).toBe("mention");
    expect(outreachEventKind({ type: "message", channel: "G123", channel_type: "group" })).toBe("ignore");
    expect(outreachEventKind({ type: "message", channel: "C123", channel_type: "channel" })).toBe("ignore");
  });
});
