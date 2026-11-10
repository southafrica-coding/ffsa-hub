import { describe, expect, it } from "vitest";
import {
  presentationForMessage,
  presentationForStatus,
  recipientLogStatus,
} from "./delivery-state";

const quiet = {
  opened_at: null as string | null,
  first_clicked_at: null as string | null,
};

describe("email delivery presentation", () => {
  it("treats sent, with no open and no click, as success", () => {
    const view = presentationForMessage({
      status: "sent",
      sent_at: "2026-11-01T00:00:00Z",
      ...quiet,
    });
    expect(view).toEqual({ label: "Sent", tone: "success" });
    expect(view.label).not.toMatch(/not opened|no click|unopened|awaiting/i);
    expect(presentationForStatus("sent").tone).toBe("success");
  });

  it("treats delivered, with no open and no click, as success", () => {
    expect(
      presentationForMessage({
        status: "delivered",
        delivered_at: "2026-11-01T00:00:00Z",
        ...quiet,
      })
    ).toEqual({ label: "Delivered", tone: "success" });
  });

  it("treats bounced and failed as problems", () => {
    expect(presentationForMessage({ status: "bounced" })).toMatchObject({
      label: "Bounced",
      tone: "problem",
    });
    expect(presentationForMessage({ status: "failed" })).toMatchObject({
      label: "Failed",
      tone: "problem",
    });
    expect(presentationForStatus("sent").tone).not.toBe("problem");
    expect(presentationForStatus("delivered").tone).not.toBe("problem");
  });

  it("does not warn on a campaign recipient who was sent but never clicked", () => {
    expect(
      recipientLogStatus({
        sent_at: "2026-11-01T00:00:00Z",
        delivered_at: null,
        opened_at: null,
        first_clicked_at: null,
        bounced_at: null,
        complained_at: null,
      })
    ).toMatchObject({ label: "Sent", tone: "good" });

    expect(
      recipientLogStatus({
        sent_at: "2026-11-01T00:00:00Z",
        delivered_at: "2026-11-01T01:00:00Z",
        opened_at: null,
        first_clicked_at: null,
      })
    ).toMatchObject({ label: "Delivered", tone: "good" });

    expect(
      recipientLogStatus({
        sent_at: "2026-11-01T00:00:00Z",
        bounced_at: "2026-11-01T01:00:00Z",
        delivered_at: null,
        opened_at: null,
        first_clicked_at: null,
      })
    ).toMatchObject({ label: "Bounced", tone: "bad" });
  });
});
