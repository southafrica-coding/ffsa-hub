import { describe, it, expect } from "vitest";
import { getOutstandingConsents } from "@/services/consent";
import { createFakeSupabase, filterValue, measure, type FakeQuery } from "@/lib/testing/fake-supabase";

type Agreements = Partial<Record<"privacy" | "child_protection" | "nda", string>>;

function client(opts: {
  agreements: Agreements;
  accepted: string[]; // agreement versions the user has a record for
  failRecords?: boolean;
  latencyMs?: number;
}) {
  return createFakeSupabase({
    user: { id: "u1" },
    latencyMs: opts.latencyMs,
    resolve: (q: FakeQuery) => {
      if (q.table === "consent_agreements") {
        const kind = filterValue(q, "eq", "kind") as keyof Agreements;
        const version = opts.agreements[kind];
        return version
          ? { data: { id: `a-${kind}`, version, kind, title: `${kind} title`, body_markdown: "", effective_at: "", is_current: true } }
          : { data: null, error: { message: "not found" } };
      }
      if (q.table === "consent_records") {
        if (opts.failRecords) return { data: null, error: { message: "boom" } };
        const version = filterValue(q, "eq", "agreement_version") as string;
        return { data: opts.accepted.includes(version) ? [{ id: "c" }] : [] };
      }
      return { data: [] };
    },
  });
}

const ALL: Agreements = { privacy: "p2", child_protection: "c1", nda: "n3" };

describe("getOutstandingConsents", () => {
  it("lists every unaccepted agreement, in REQUIRED_CONSENTS order", async () => {
    const f = client({ agreements: ALL, accepted: [] });
    const out = await getOutstandingConsents(f.client, "u1", true);
    expect(out.map((o) => [o.kind, o.agreement.version])).toEqual([
      ["privacy", "p2"],
      ["child_protection", "c1"],
      ["nda", "n3"],
    ]);
  });

  it("the NDA is only for staff", async () => {
    const f = client({ agreements: ALL, accepted: [] });
    const out = await getOutstandingConsents(f.client, "u1", false);
    expect(out.map((o) => o.kind)).toEqual(["privacy", "child_protection"]);
  });

  it("accepted versions drop out; a NEW version re-prompts", async () => {
    const f = client({ agreements: ALL, accepted: ["p1", "c1", "n3"] });
    const out = await getOutstandingConsents(f.client, "u1", true);
    expect(out.map((o) => o.kind)).toEqual(["privacy"]);
  });

  it("skips kinds with nothing published", async () => {
    const f = client({ agreements: { privacy: "p2" }, accepted: [] });
    const out = await getOutstandingConsents(f.client, "u1", true);
    expect(out.map((o) => o.kind)).toEqual(["privacy"]);
  });

  it("fails open when the records read errors", async () => {
    const f = client({ agreements: ALL, accepted: [], failRecords: true });
    expect(await getOutstandingConsents(f.client, "u1", true)).toEqual([]);
  });

  it("reads each agreement once and checks kinds side by side", async () => {
    const f = client({ agreements: ALL, accepted: [], latencyMs: 20 });
    const { roundTrips } = await measure(20, () => getOutstandingConsents(f.client, "u1", true));
    expect(f.queries.filter((q) => q.table === "consent_agreements")).toHaveLength(3);
    expect(roundTrips).toBeLessThanOrEqual(2);
  });
});
