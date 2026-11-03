import { z } from "zod";

import { ApiError } from "@/lib/api";

import {
  cancelSpace,
  cancelVehicle,
  checkSpace,
  checkVehicles,
  decideSpace,
  decideVehicle,
  isTransient,
  listPeople,
  recordInspection,
  submitSpace,
  submitVehicle,
  uploadInspectionPhoto,
  userMessage,
} from "../api";
import { createBookingsFetch, ServerRefusal, type BookingsFetch } from "../http";
import { EMPTY_SPACE, EMPTY_VEHICLE } from "../logic";

type Call = { url: string; init: RequestInit };

function harness(respond: (c: Call) => Response | Promise<Response>, token: string | null = "tok") {
  const calls: Call[] = [];
  const onAuthFailure = jest.fn();
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    return respond(c);
  }) as unknown as typeof fetch;
  const f = createBookingsFetch({ baseUrl: "https://hub.example.test", getAccessToken: async () => token, onAuthFailure, fetchImpl, timeoutMs: 50 });
  return { f, calls, onAuthFailure };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("bookingsFetch", () => {
  it("sends the bearer token and JSON", async () => {
    const h = harness(() => json(200, { ok: true }));
    await h.f("/api/x", { method: "POST", body: { a: 1 } });
    const headers = h.calls[0].init.headers as Record<string, string>;
    expect(h.calls[0].url).toBe("https://hub.example.test/api/x");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers.Accept).toBe("application/json");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(h.calls[0].init.body).toBe('{"a":1}');
  });

  it("sends FormData as multipart (no Content-Type, so the boundary is set by the platform)", async () => {
    const h = harness(() => json(200, { ok: true }));
    const form = new FormData();
    form.append("kind", "license");
    await h.f("/api/up", { method: "POST", body: form });
    expect((h.calls[0].init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(h.calls[0].init.body).toBe(form);
  });

  it("keeps the server's words on a 4xx refusal", async () => {
    const h = harness(() => json(409, { error: "That time is already booked.", blocked: true, conflicts: [] }));
    const err = await h.f("/api/x", { method: "POST", body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerRefusal);
    expect((err as ServerRefusal).message).toBe("That time is already booked.");
    expect((err as ServerRefusal).status).toBe(409);
    expect((err as ServerRefusal).body.blocked).toBe(true);
  });

  it("a 5xx or a wordless 4xx is a generic error", async () => {
    const h = harness(() => json(500, { error: "db exploded" }));
    const e5 = await h.f("/api/x").catch((e: unknown) => e);
    expect(e5).toBeInstanceOf(ApiError);
    expect(e5).not.toBeInstanceOf(ServerRefusal);
    expect((e5 as ApiError).message).toMatch(/\(500\)/);
    const h2 = harness(() => new Response("", { status: 400 }));
    expect(await h2.f("/api/x").catch((e: unknown) => e)).not.toBeInstanceOf(ServerRefusal);
  });

  it("401 signs out; 403 deactivated signs out with the reason; other 403 is forbidden", async () => {
    const a = harness(() => json(401, { error: "unauthenticated" }));
    await expect(a.f("/api/x")).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(a.onAuthFailure).toHaveBeenCalledWith("unauthenticated");

    const b = harness(() => json(403, { error: "deactivated" }));
    await expect(b.f("/api/x")).rejects.toMatchObject({ kind: "deactivated" });
    expect(b.onAuthFailure).toHaveBeenCalledWith("deactivated");

    const c = harness(() => json(403, { error: "Not authorized" }));
    await expect(c.f("/api/x")).rejects.toMatchObject({ kind: "forbidden" });
    expect(c.onAuthFailure).not.toHaveBeenCalled();
  });

  it("no token: signed out without calling the server", async () => {
    const h = harness(() => json(200, {}), null);
    await expect(h.f("/api/x")).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(h.calls).toHaveLength(0);
  });

  it("network failure and timeout", async () => {
    const n = harness(() => {
      throw new TypeError("Network request failed");
    });
    await expect(n.f("/api/x")).rejects.toMatchObject({ kind: "network" });

    const t = harness(
      (c) =>
        new Promise<Response>((_, reject) => {
          c.init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await expect(t.f("/api/x")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("an unreadable answer is reported, not passed on", async () => {
    const h = harness(() => json(200, { nope: 1 }));
    await expect(h.f("/api/x", { schema: z.object({ ok: z.literal(true) }) })).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("the bookings API contract (mocked fetch)", () => {
  function recorder(answer: unknown | ((path: string, init: unknown) => unknown)) {
    const calls: { path: string; init: { method?: string; body?: unknown; timeoutMs?: number } }[] = [];
    const f = (async (path: string, init: { method?: string; body?: unknown; schema?: z.ZodType; timeoutMs?: number } = {}) => {
      calls.push({ path, init });
      const value = typeof answer === "function" ? (answer as (p: string, i: unknown) => unknown)(path, init) : answer;
      if (value instanceof Error) throw value;
      return init.schema ? init.schema.parse(value) : value;
    }) as BookingsFetch;
    return { f, calls };
  }

  const space = { ...EMPTY_SPACE, venueId: "v1", date: "2026-11-10", title: "Youth night" };

  it("space clash check is a dry run of POST /api/bookings", async () => {
    const r = recorder({ ok: true, conflicts: [{ date: "2026-11-10", existingId: "x", existingTitle: "Prayer", existingTime: "all day", occupiedUntil: "the end of the day", who: null }], autoConfirm: true, blocked: true });
    const res = await checkSpace(r.f, space);
    expect(r.calls[0]).toMatchObject({ path: "/api/bookings", init: { method: "POST", body: { dryRun: true, venue_id: "v1", booking_date: "2026-11-10" } } });
    expect(res.blocked).toBe(true);
    expect(res.conflicts[0].existingTitle).toBe("Prayer");
  });

  it("submitSpace: created, or the server's hard block with its clashes", async () => {
    const ok = recorder({ ok: true, bookingId: "b9", autoConfirm: false, conflicts: [] });
    expect(await submitSpace(ok.f, space)).toEqual({ kind: "created", bookingId: "b9", autoConfirm: false });
    expect((ok.calls[0].init.body as { dryRun: boolean }).dryRun).toBe(false);

    const refused = new ServerRefusal("That time is already booked.", 409, {
      blocked: true,
      conflicts: [{ date: "2026-11-10", existingId: "x", existingTitle: "Prayer", existingTime: "09:00 – 10:00", occupiedUntil: "10:00", who: "Ana" }],
    });
    const blocked = recorder(refused);
    expect(await submitSpace(blocked.f, space)).toMatchObject({ kind: "blocked", message: "That time is already booked.", conflicts: [{ who: "Ana" }] });

    const other = recorder(new ServerRefusal("title is required", 400, {}));
    await expect(submitSpace(other.f, space)).rejects.toBeInstanceOf(ServerRefusal);
  });

  it("cancel and decide hit the web's routes with the web's bodies", async () => {
    const r = recorder({ ok: true });
    await cancelSpace(r.f, "b 1", true);
    await decideSpace(r.f, "b1", "denied", "  Clashes with camp ", false);
    await decideSpace(r.f, "b1", "approved", "", true);
    await cancelVehicle(r.f, "v1");
    await decideVehicle(r.f, "v1", "approved", "");
    expect(r.calls.map((c) => [c.path, c.init.method, c.init.body])).toEqual([
      ["/api/bookings/b%201", "PATCH", { cancel: true, applyToSeries: true }],
      ["/api/bookings/b1/decision", "POST", { decision: "denied", note: "Clashes with camp", applyToSeries: false }],
      ["/api/bookings/b1/decision", "POST", { decision: "approved", note: null, applyToSeries: true }],
      ["/api/vehicles/bookings/v1", "PATCH", { status: "cancelled" }],
      ["/api/vehicles/bookings/v1/decision", "POST", { decision: "approved", note: null }],
    ]);
  });

  it("vehicle availability, create, people", async () => {
    const r = recorder((path: string) =>
      path === "/api/vehicles/people"
        ? { people: [{ id: "p1", name: "Sam", base_driving_test_status: "weird" }] }
        : (r.calls.length === 1 ? { ok: true, unavailableVehicleIds: ["v2"], clashingVehicleIds: [], blocked: false } : { ok: true, bookingId: "vb9", drivers: [] }),
    );
    const avail = await checkVehicles(r.f, "2026-11-10", "2026-11-12");
    expect(avail.unavailableVehicleIds).toEqual(["v2"]);
    expect(r.calls[0].init.body).toMatchObject({ dryRun: true, checkout_date: "2026-11-10", return_date: "2026-11-12" });
    const created = await submitVehicle(r.f, { ...EMPTY_VEHICLE, checkout: "2026-11-10", returnDate: "2026-11-12", bookingName: "Trip", pointPerson: "Jo", destination: "Durban" });
    expect(created.bookingId).toBe("vb9");
    expect((r.calls[1].init.body as { dryRun?: boolean }).dryRun).toBeUndefined();
    const people = await listPeople(r.f);
    // Unknown values parse safely.
    expect(people[0].base_driving_test_status).toBe("not_required");
  });

  it("photos go multipart to the upload route with the web's field names; the form to /inspections", async () => {
    const r = recorder({ ok: true });
    await uploadInspectionPhoto(r.f, { bookingId: "vb1", kind: "fuel_gauge", localUri: "file:///p.jpg", fileName: "p.jpg", mimeType: "image/jpeg" });
    const call = r.calls[0];
    expect(call.path).toBe("/api/vehicles/inspections/upload");
    expect(call.init.timeoutMs).toBeGreaterThan(15_000);
    const form = call.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("booking_id")).toBe("vb1");
    expect(form.get("kind")).toBe("fuel_gauge");
    await recordInspection(r.f, { kind: "collection", vehicle_booking_id: "vb1" });
    expect(r.calls[1]).toMatchObject({ path: "/api/vehicles/inspections", init: { method: "POST", body: { kind: "collection" } } });
  });

  it("plain messages, and what's worth retrying", () => {
    expect(userMessage(new ServerRefusal("Can't approve — Sam has no licence photo on this booking.", 409, {}))).toMatch(/Sam has no licence/);
    expect(userMessage(new ApiError("forbidden", "x", 403))).toMatch(/isn't available on your account/);
    expect(userMessage(new ApiError("http", "x", 404))).toMatch(/couldn't be found/);
    expect(userMessage(new ApiError("unauthenticated", "x", 401))).toMatch(/signed out/);
    expect(userMessage("??")).toBe("Something went wrong. Try again.");
    expect(isTransient(new ApiError("network", "x"))).toBe(true);
    expect(isTransient(new ApiError("http", "x", 503))).toBe(true);
    expect(isTransient(new ServerRefusal("bad", 400, {}))).toBe(false);
    expect(isTransient(new ApiError("forbidden", "x", 403))).toBe(false);
  });
});
