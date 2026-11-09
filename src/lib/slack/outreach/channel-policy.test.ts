import { describe, expect, it } from "vitest";
import { GROUP_DM_TELL, PUBLIC_CHANNEL_TELL, SHARED_CHANNEL_TELL, UNKNOWN_CHANNEL_TELL, receiptDoor } from "./channel-policy";

describe("receiptDoor", () => {
  it("lets a DM through without asking Slack", () => {
    expect(receiptDoor({ isDM: true, channel: null })).toEqual({ ok: true, place: "dm" });
    expect(receiptDoor({ isDM: false, channel: { is_im: true } })).toEqual({ ok: true, place: "dm" });
  });

  it("lets a private channel the bot is in through", () => {
    expect(receiptDoor({ isDM: false, channel: { is_private: true, is_member: true } })).toEqual({
      ok: true,
      place: "private_channel",
    });
  });

  it("refuses a public channel", () => {
    const door = receiptDoor({ isDM: false, channel: { is_private: false, is_member: true } });
    expect(door.ok).toBe(false);
    if (!door.ok) expect(door.tell).toBe(PUBLIC_CHANNEL_TELL);
  });

  it("refuses a group DM and a private channel the bot is not in", () => {
    expect(receiptDoor({ isDM: false, channel: { is_mpim: true, is_private: true } }).ok).toBe(false);
    expect(receiptDoor({ isDM: false, channel: { is_mpim: true } })).toMatchObject({ tell: GROUP_DM_TELL });
    expect(receiptDoor({ isDM: false, channel: { is_private: true, is_member: false } }).ok).toBe(false);
  });

  it("refuses a Slack Connect or shared channel even when it is private", () => {
    const door = receiptDoor({
      isDM: false,
      channel: { is_private: true, is_member: true, is_ext_shared: true },
    });
    expect(door).toEqual({ ok: false, tell: SHARED_CHANNEL_TELL });
    expect(receiptDoor({ isDM: false, channel: { is_private: true, is_shared: true } }).ok).toBe(false);
  });

  it("stays shut when privacy can't be proven", () => {
    const door = receiptDoor({ isDM: false, channel: null });
    expect(door).toEqual({ ok: false, tell: UNKNOWN_CHANNEL_TELL });
    expect(receiptDoor({ isDM: false, channel: {} })).toEqual({ ok: false, tell: UNKNOWN_CHANNEL_TELL });
  });
});
