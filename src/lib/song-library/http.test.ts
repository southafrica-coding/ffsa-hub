import { describe, expect, it, vi } from "vitest";
import { dbError } from "./http";
import { SL_AGREED_REVOKE_GUARD } from "./types";

describe("Song Library dbError", () => {
  it("423's guard (a writer withdrawing after splits are agreed, 42501) is 409 credits_agreed, not 403", async () => {
    const r = dbError({ code: "42501", message: SL_AGREED_REVOKE_GUARD });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("credits_agreed");
  });

  it("matches 423's exact RAISE text", () => {
    expect(SL_AGREED_REVOKE_GUARD).toBe("Splits are agreed for this song; only a Song Library manager or an admin can revoke the agreement");
  });

  it("other 42501s stay 403 forbidden; 419's 23514 named refusals are unchanged", async () => {
    for (const message of ["new row violates row-level security policy", "Only that writer can confirm their own split", "Only that writer, a Song Library manager or an admin can withdraw this confirmation"]) {
      const r = dbError({ code: "42501", message });
      expect(r.status).toBe(403);
      expect((await r.json()).code).toBe("forbidden");
    }
    const agreed = dbError({ code: "23514", message: "Credits are agreed for this song; revoke the agreement (un-confirm) before changing writers or splits" });
    expect(agreed.status).toBe(409);
    expect((await agreed.json()).code).toBe("credits_agreed");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(dbError({ code: "XX000", message: "boom" }).status).toBe(500);
    spy.mockRestore();
  });
});
