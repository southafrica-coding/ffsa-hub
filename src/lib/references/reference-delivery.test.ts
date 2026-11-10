import { describe, expect, it } from "vitest";
import {
  REFERENCE_BOUNCE_MESSAGE,
  buildReferenceBounceAlerts,
  listReferenceBounceAlerts,
  referenceEmailProblem,
  referenceProblemCopy,
  staffCanSeeReferenceAlert,
  type ReferenceDeliveryMessage,
  type ReferenceForAlert,
} from "./reference-delivery";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

const ref: ReferenceForAlert = {
  id: "ref-1",
  application_id: "app-1",
  program_id: "prog-1",
  referee_email: "typo@example.com",
  status: "pending",
  email_sent_at: "2026-11-01T00:00:00Z",
  applicant_name: "Sam Lee",
  program_name: "DTS",
};

function msg(partial: Partial<ReferenceDeliveryMessage>): ReferenceDeliveryMessage {
  return {
    to_email: "typo@example.com",
    category: "reference_request",
    status: "sent",
    bounce_type: null,
    source_type: "reference_request",
    source_id: "ref-1",
    created_at: "2026-11-01T00:00:00Z",
    error: "550 5.1.1 user unknown",
    ...partial,
  };
}

describe("reference address state", () => {
  it("asks for a correction on a hard bounce and hides the diagnostic", () => {
    expect(referenceEmailProblem(ref, "app-1", [msg({ status: "bounced", bounce_type: "hard" })])).toBe(
      "bounced"
    );
    const copy = referenceProblemCopy("bounced");
    expect(copy).toBe(REFERENCE_BOUNCE_MESSAGE);
    expect(copy).not.toMatch(/550|user unknown|smtp/i);
  });

  it("does not treat a sent message with no open or click as a problem", () => {
    expect(
      referenceEmailProblem(ref, "app-1", [
        msg({ status: "sent", created_at: "2026-11-02T00:00:00Z" }),
      ])
    ).toBeNull();
    expect(
      referenceEmailProblem(ref, "app-1", [
        msg({ status: "delivered", created_at: "2026-11-02T00:00:00Z" }),
      ])
    ).toBeNull();
  });

  it("clears the bounce once a later send to the same address succeeded", () => {
    expect(
      referenceEmailProblem(ref, "app-1", [
        msg({ status: "bounced", bounce_type: "hard", created_at: "2026-11-01T00:00:00Z" }),
        msg({ status: "sent", created_at: "2026-11-03T00:00:00Z" }),
      ])
    ).toBeNull();
  });

  it("marks a failed send as not sent", () => {
    expect(
      referenceEmailProblem(
        { ...ref, email_sent_at: null },
        "app-1",
        [msg({ status: "failed", error: "Resend send failed" })]
      )
    ).toBe("not_sent");
    expect(referenceProblemCopy("not_sent")).not.toMatch(/Resend|550/);
  });
});

describe("reference bounce alerts", () => {
  it("fires once for repeat hard-bounce events on the same reference", () => {
    const first = msg({
      status: "bounced",
      bounce_type: "hard",
      created_at: "2026-11-01T00:00:00Z",
    });
    const retry = msg({
      status: "bounced",
      bounce_type: "hard",
      category: "reference_reminder",
      created_at: "2026-11-04T00:00:00Z",
      error: "550 mailbox does not exist",
    });
    const once = buildReferenceBounceAlerts([ref], [first]);
    const twice = buildReferenceBounceAlerts([ref], [first, retry]);
    expect(once).toHaveLength(1);
    expect(twice).toHaveLength(1);
    expect(once[0].key).toBe("reference-bounce:ref-1");
    expect(twice[0].key).toBe(once[0].key);
    expect(twice[0].body).toContain("typo@example.com");
    expect(twice[0].body).toContain("Sam Lee");
    expect(twice[0].body).not.toMatch(/550|does not exist/);
  });

  it("does not alert when a later send succeeded, or for a soft bounce", () => {
    expect(
      buildReferenceBounceAlerts(
        [ref],
        [
          msg({ status: "bounced", bounce_type: "hard", created_at: "2026-11-01T00:00:00Z" }),
          msg({ status: "delivered", created_at: "2026-11-05T00:00:00Z" }),
        ]
      )
    ).toEqual([]);
    expect(
      buildReferenceBounceAlerts(
        [ref],
        [msg({ status: "bounced", bounce_type: "soft" })]
      )
    ).toEqual([]);
    expect(
      buildReferenceBounceAlerts(
        [ref],
        [msg({ category: "application_received", status: "bounced", bounce_type: "hard" })]
      )
    ).toEqual([]);
  });

  it("shows the alert to that program's staff and not to another program", () => {
    const alert = buildReferenceBounceAlerts(
      [ref],
      [msg({ status: "bounced", bounce_type: "hard" })]
    )[0];
    expect(staffCanSeeReferenceAlert(alert, { isAdmin: true, programIds: [], applicationIds: [] })).toBe(
      true
    );
    expect(
      staffCanSeeReferenceAlert(alert, { isAdmin: false, programIds: ["prog-1"], applicationIds: [] })
    ).toBe(true);
    expect(
      staffCanSeeReferenceAlert(alert, { isAdmin: false, programIds: [], applicationIds: ["app-1"] })
    ).toBe(true);
    expect(
      staffCanSeeReferenceAlert(alert, { isAdmin: false, programIds: ["other"], applicationIds: [] })
    ).toBe(false);
  });
});

describe("listReferenceBounceAlerts", () => {
  const bounce = {
    to_email: "typo@example.com",
    category: "reference_request",
    status: "bounced",
    bounce_type: "hard",
    source_type: "reference_request",
    source_id: "ref-1",
    created_at: "2026-11-01T00:00:00Z",
    bounced_at: "2026-11-01T00:00:00Z",
    error: "550 user unknown",
  };
  const later = {
    ...bounce,
    status: "sent",
    bounce_type: null,
    created_at: "2026-11-06T00:00:00Z",
    error: null,
  };
  const reference = {
    id: "ref-1",
    application_id: "app-1",
    referee_email: "typo@example.com",
    status: "pending",
    email_sent_at: "2026-11-01T00:00:00Z",
  };
  const application = {
    id: "app-1",
    program_id: "prog-1",
    applicant_info: { first_name: "Sam", last_name: "Lee" },
    programs: { name: "DTS" },
  };

  function admin(messages: Array<Record<string, unknown>>) {
    return createFakeSupabase({
      resolve: (q: FakeQuery) => {
        if (q.table === "email_messages") {
          const status = filterValue(q, "eq", "status");
          const rows = status ? messages.filter((m) => m.status === status) : messages;
          return { data: rows };
        }
        if (q.table === "reference_requests") return { data: [reference] };
        if (q.table === "application_responses") return { data: [application] };
        return { data: [] };
      },
    }).client;
  }

  it("returns one alert, and the same alert if asked again", async () => {
    const first = await listReferenceBounceAlerts(admin([bounce, { ...bounce, created_at: "2026-11-02T00:00:00Z" }]));
    const second = await listReferenceBounceAlerts(admin([bounce]));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].key).toBe(second[0].key);
    expect(first[0].body).not.toContain("550");
  });

  it("drops the alert after a later confirmed send", async () => {
    const alerts = await listReferenceBounceAlerts(admin([bounce, later]));
    expect(alerts).toEqual([]);
  });
});
