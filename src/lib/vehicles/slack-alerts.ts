// Vehicles → Slack DMs for the vehicle coordinator (migration 234).
//
// Runs ALONGSIDE the manager emails (notifyVehicleManagers), never instead:
//   • request   — booking + drivers' licence status + free vehicles, with
//                 Assign vehicle / Approve / Deny / Open in Hub. Rewritten in
//                 place once it's decided (in Slack or the Hub).
//   • collected / paid / signed / cancelled — FYI.
//   • returned  — mileage, km driven, wash/fuel, damage, + Mark completed.
//   • digest    — 07:00 SAST: pickups, returns, overdue, unpaid, waiting.
//
// Everything is best-effort: nothing here may fail the action that triggered
// it. All reads use the ADMIN client (callers are already authorised).

import * as slack from "@/lib/slack/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateRangeLabel } from "@/lib/bookings/dates";
import { checkDriverEligibility } from "@/lib/vehicles/licence";
import {
  DAMAGE_PANELS,
  INVENTORY_ITEMS,
  dayCount,
  purposeLabel,
  randsLabel,
  getLicenceFactsFor,
  getOverlappingAssignments,
  type VehicleBookingWithRefs,
} from "@/services/vehicles";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";
const bookingUrl = (id: string) => `${SITE}/bookings/vehicles/${id}`;

export const VH_ASSIGN = "vh_assign";
export const VH_APPROVE = "vh_approve";
export const VH_DENY = "vh_deny";
export const VH_COMPLETE = "vh_complete";
export const VH_OPEN = "vh_open";
export const VH_DENY_VIEW = "vh_deny_view";
export const isVehicleAction = (actionId: string) => actionId.startsWith("vh_");

type Block = Record<string, unknown>;
type Message = { text: string; blocks: Block[] };

const panelLabel = new Map(DAMAGE_PANELS.map((p) => [p.key, p.label]));
const itemLabel = new Map(INVENTORY_ITEMS.map((i) => [i.key, i.label]));

const section = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text } });
const context = (text: string): Block => ({ type: "context", elements: [{ type: "mrkdwn", text }] });
const openButton = (id: string): Block => ({
  type: "button",
  action_id: VH_OPEN,
  text: { type: "plain_text", text: "Open in Hub" },
  url: bookingUrl(id),
});

// ── recipients + posting ────────────────────────────────────

async function recipients(admin: Client): Promise<{ userId: string; slackUserId: string }[]> {
  const { data: settings } = await admin.from("vehicle_alert_settings").select("slack_alert_user_ids").maybeSingle();
  const ids = ((settings?.slack_alert_user_ids as string[] | null) ?? []).filter(Boolean);
  if (ids.length === 0) return [];
  const { data } = await admin.from("users").select("id, slack_user_id").in("id", ids);
  return ((data ?? []) as { id: string; slack_user_id: string | null }[])
    .filter((u) => u.slack_user_id)
    .map((u) => ({ userId: u.id, slackUserId: u.slack_user_id as string }));
}

async function dm(slackUserId: string, message: Message): Promise<{ channel: string; ts: string } | null> {
  const open = await slack.openConversation(slackUserId);
  if (!open.ok || !open.channel?.id) {
    console.error("[vehicles/slack] conversations.open failed", open.error);
    return null;
  }
  const res = await slack.postMessage({ channel: open.channel.id, ...message });
  if (!res.ok || !res.ts) {
    console.error("[vehicles/slack] postMessage failed", res.error);
    return null;
  }
  return { channel: res.channel ?? open.channel.id, ts: res.ts };
}

/** DM everyone, recording the message so it can be rewritten later. */
async function postTracked(admin: Client, bookingId: string, kind: "request" | "returned", message: Message) {
  for (const r of await recipients(admin)) {
    // Claim first: two triggers racing must not double-DM.
    const { data: claimed } = await admin
      .from("vehicle_booking_slack_alerts")
      .upsert(
        { vehicle_booking_id: bookingId, kind, recipient_user_id: r.userId, slack_channel: "", slack_ts: "" },
        { onConflict: "vehicle_booking_id,kind,recipient_user_id", ignoreDuplicates: true }
      )
      .select("id");
    const rowId = (claimed as { id: string }[] | null)?.[0]?.id;
    if (!rowId) continue;
    const posted = await dm(r.slackUserId, message);
    if (posted) {
      await admin.from("vehicle_booking_slack_alerts").update({ slack_channel: posted.channel, slack_ts: posted.ts }).eq("id", rowId);
    } else {
      await admin.from("vehicle_booking_slack_alerts").delete().eq("id", rowId);
    }
  }
}

async function postFyi(admin: Client, message: Message) {
  for (const r of await recipients(admin)) await dm(r.slackUserId, message);
}

// ── booking context ─────────────────────────────────────────

type Inspection = {
  kind: "collection" | "return";
  mileage: number | null;
  fuel_full: boolean | null;
  washed: boolean | null;
  damage_reported: boolean | null;
  damage_panels: string[] | null;
  inventory: Record<string, boolean> | null;
  condition_notes: string | null;
  driver_names: string | null;
  created_at: string;
};

type Ctx = {
  b: VehicleBookingWithRefs;
  assigned: { id: string; name: string; plate: string | null }[];
  free: { id: string; name: string; type: string }[];
  driverLines: string[];
  inspections: Inspection[];
};

async function loadCtx(admin: Client, bookingId: string): Promise<Ctx | null> {
  const { data } = await admin
    .from("vehicle_bookings")
    .select(
      "*, assignments:vehicle_booking_assignments(vehicle:vehicles(id,name,vehicle_type,color,registration_plate)), drivers:vehicle_booking_drivers(*)"
    )
    .eq("id", bookingId)
    .maybeSingle();
  const b = data as VehicleBookingWithRefs | null;
  if (!b) return null;

  const [fleetRes, overlapping, inspRes] = await Promise.all([
    admin.from("vehicles").select("id, name, vehicle_type, status").eq("status", "active").order("sort_order"),
    getOverlappingAssignments(admin, b.checkout_date, b.return_date, b.id),
    admin
      .from("vehicle_inspections")
      .select("kind, mileage, fuel_full, washed, damage_reported, damage_panels, inventory, condition_notes, driver_names, created_at")
      .eq("vehicle_booking_id", b.id)
      .order("created_at", { ascending: true }),
  ]);
  const held = new Set(overlapping.map((a) => a.vehicle_id));
  const free = ((fleetRes.data ?? []) as { id: string; name: string; vehicle_type: string }[])
    .filter((v) => !held.has(v.id))
    .map((v) => ({ id: v.id, name: v.name, type: v.vehicle_type }));

  const assigned = (b.assignments ?? [])
    .map((a) => a.vehicle)
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => ({ id: v.id, name: v.name, plate: v.registration_plate }));

  // Drivers: the same approval-stage licence check the Approve button runs.
  const drivers = b.drivers ?? [];
  const facts = await getLicenceFactsFor(
    admin,
    drivers.filter((d) => d.user_id).map((d) => d.user_id as string)
  );
  const driverLines = drivers.map((d) => {
    if (!d.user_id) return `• ${d.name} — _not a Hub user, check their licence_`;
    const f = facts.get(d.user_id);
    const check = f
      ? checkDriverEligibility(
          {
            licence_expiry_date: f.expiry,
            licence_file_url: f.hasFile ? "on-file" : null,
            base_driving_test_status: f.test as "not_required" | "pending" | "passed" | "failed",
          },
          b.return_date,
          "approval"
        )
      : ({ ok: false, reason: "no_licence", message: "No licence on file." } as const);
    if (check.ok) return `• ✅ ${d.name} — licence valid${f?.expiry ? ` to ${f.expiry}` : ""}`;
    return `• ${check.reason === "test_pending" ? "⚠️" : "❌"} ${d.name} — ${check.message}`;
  });

  return { b, assigned, free, driverLines, inspections: (inspRes.data ?? []) as Inspection[] };
}

function headline(b: VehicleBookingWithRefs): string {
  const days = dayCount(b.checkout_date, b.return_date);
  return `${dateRangeLabel(b.checkout_date, b.return_date)} (${days} day${days === 1 ? "" : "s"})`;
}

function factsLine(b: VehicleBookingWithRefs): string {
  return [
    b.requester_name,
    b.num_people ? `${b.num_people} people` : null,
    `${purposeLabel(b.purpose)}${b.purpose_note ? ` — ${b.purpose_note}` : ""}`,
    b.source === "public" ? "via public link" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function moneyLine(b: VehicleBookingWithRefs): string | null {
  if (!b.payment_required) return null;
  if (b.payment_received) return "💳 Paid";
  if (b.total_amount) return `💳 Due: ${b.currency === "USD" ? `$${b.total_amount}` : `R${b.total_amount}`} — not paid yet`;
  return "💳 Payment required — no price set yet";
}

// ── the request DM ──────────────────────────────────────────

function requestOpenMessage(c: Ctx): Message {
  const { b } = c;
  // "Free" = not held by any OTHER booking and not already on this one.
  const others = c.free.filter((v) => !c.assigned.some((a) => a.id === v.id));
  const vans = others.filter((v) => v.type === "van").length;
  const cars = others.filter((v) => v.type === "car").length;
  const contact = [b.requester_email, b.requester_phone].filter(Boolean).join(" · ");

  // Options = free vehicles + whatever is already assigned (it holds itself).
  const optionVehicles = [
    ...c.assigned.map((a) => ({ id: a.id, name: a.name })),
    ...others,
  ];
  const opt = (v: { id: string; name: string }) => ({ text: { type: "plain_text", text: v.name.slice(0, 75) }, value: v.id });

  const assign: Block = {
    type: "multi_static_select",
    action_id: VH_ASSIGN,
    placeholder: { type: "plain_text", text: "Assign vehicle…" },
    options: optionVehicles.length ? optionVehicles.map(opt) : [{ text: { type: "plain_text", text: "No vehicles free" }, value: "none" }],
    ...(c.assigned.length ? { initial_options: c.assigned.map(opt) } : {}),
  };

  const blocks: Block[] = [
    section(`*🚐 New vehicle request — ${b.booking_name}*\n${headline(b)}\n${factsLine(b)}${contact ? `\n${contact}` : ""}`),
    section(`*Drivers*\n${c.driverLines.length ? c.driverLines.join("\n") : "_None listed_"}`),
    section(
      [
        `*Also free those dates:* ${vans} van${vans === 1 ? "" : "s"}, ${cars} car${cars === 1 ? "" : "s"}${
          others.length ? ` (${others.map((v) => v.name).join(", ")})` : ""
        }`,
        `*Assigned:* ${c.assigned.length ? c.assigned.map((a) => a.name).join(", ") : "_none yet_"}`,
        moneyLine(b),
        b.notes ? `*Notes:* ${b.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    ),
    {
      type: "actions",
      block_id: `vh:${b.id}`,
      elements: [
        assign,
        {
          type: "button",
          action_id: VH_APPROVE,
          style: "primary",
          text: { type: "plain_text", text: "Approve" },
          value: b.id,
          ...(c.assigned.length
            ? {}
            : {
                confirm: {
                  title: { type: "plain_text", text: "Approve without a vehicle?" },
                  text: { type: "plain_text", text: "No vehicle is assigned yet. You can assign one later in the Hub." },
                  confirm: { type: "plain_text", text: "Approve" },
                  deny: { type: "plain_text", text: "Cancel" },
                },
              }),
        },
        { type: "button", action_id: VH_DENY, style: "danger", text: { type: "plain_text", text: "Deny" }, value: b.id },
        openButton(b.id),
      ],
    },
    context("Approving emails the requester, like in the Hub. Approve re-checks every driver's licence."),
  ];
  return { text: `New vehicle request — ${b.booking_name}`, blocks };
}

const STATUS_LINE: Record<string, string> = {
  approved: "✅ Approved",
  denied: "❌ Denied",
  cancelled: "🚫 Cancelled",
  completed: "🏁 Completed",
};

async function deciderName(admin: Client, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin.from("users").select("first_name, last_name").eq("id", userId).maybeSingle();
  return data ? `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || null : null;
}

async function requestClosedMessage(admin: Client, c: Ctx): Promise<Message> {
  const { b } = c;
  const by = b.status === "cancelled" ? null : await deciderName(admin, b.decided_by);
  const line = [
    `${STATUS_LINE[b.status] ?? b.status}${by ? ` by ${by}` : ""}`,
    c.assigned.length ? c.assigned.map((a) => a.name).join(", ") : null,
    b.decision_note ? `“${b.decision_note}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    text: `${STATUS_LINE[b.status] ?? b.status} — ${b.booking_name}`,
    blocks: [
      section(`*🚐 ${b.booking_name}*\n${headline(b)}\n${factsLine(b)}\n\n${line}`),
      context(`<${bookingUrl(b.id)}|Open the booking in the Hub>`),
    ],
  };
}

type AlertRow = { id: string; kind: string; slack_channel: string; slack_ts: string };

/**
 * Re-render the request DM (still pending → fresh vehicles / assignment;
 * decided or cancelled → closed) and close a sign-in DM once completed.
 */
export async function refreshVehicleRequestAlerts(bookingId: string): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;
  try {
    const admin = createAdminClient() as Client;
    const { data } = await admin
      .from("vehicle_booking_slack_alerts")
      .select("id, kind, slack_channel, slack_ts")
      .eq("vehicle_booking_id", bookingId)
      .eq("status", "open");
    const rows = ((data ?? []) as AlertRow[]).filter((r) => r.slack_channel && r.slack_ts);
    if (rows.length === 0) return;
    const c = await loadCtx(admin, bookingId);
    if (!c) return;

    for (const row of rows) {
      let message: Message;
      let close = false;
      if (row.kind === "request") {
        close = c.b.status !== "pending";
        message = close ? await requestClosedMessage(admin, c) : requestOpenMessage(c);
      } else {
        close = c.b.status !== "approved";
        message = close ? await requestClosedMessage(admin, c) : returnedMessage(c);
      }
      await slack.updateMessage({ channel: row.slack_channel, ts: row.slack_ts, ...message }).catch(() => null);
      if (close) {
        await admin
          .from("vehicle_booking_slack_alerts")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }
  } catch (err) {
    console.error("[vehicles/slack] refresh failed", err);
  }
}

// ── lifecycle FYIs ──────────────────────────────────────────

function inspectionLines(i: Inspection | undefined): string[] {
  if (!i) return [];
  const out: string[] = [];
  if (i.mileage != null) out.push(`*Mileage:* ${i.mileage.toLocaleString("en-ZA")} km`);
  // The walk-around damage map + inventory are recorded at sign-out only.
  if (i.kind === "collection") {
    const panels = i.damage_panels ?? [];
    out.push(panels.length ? `⚠️ *Existing damage:* ${panels.map((p) => panelLabel.get(p) ?? p).join(", ")}` : "No damage on the walk-around");
    const missing = Object.entries(i.inventory ?? {})
      .filter(([, present]) => present === false)
      .map(([k]) => itemLabel.get(k) ?? k);
    if (missing.length) out.push(`⚠️ *Missing from the vehicle:* ${missing.join(", ")}`);
  }
  if (i.condition_notes) out.push(`*Driver's notes:* ${i.condition_notes}`);
  return out;
}

function returnedMessage(c: Ctx): Message {
  const { b } = c;
  const out = [...c.inspections].reverse().find((i) => i.kind === "collection");
  const back = [...c.inspections].reverse().find((i) => i.kind === "return");
  const km = out?.mileage != null && back?.mileage != null ? back.mileage - out.mileage : null;
  const lines = [
    ...inspectionLines(back),
    km != null ? `*Driven:* ${km.toLocaleString("en-ZA")} km` : null,
    back
      ? `${back.washed ? "✅" : "⚠️"} Washed · ${back.fuel_full ? "✅" : "⚠️"} Refuelled · ${
          back.damage_reported ? "✅ Says all damage reported" : "⚠️ Didn't confirm damage reported"
        }`
      : null,
    moneyLine(b),
  ].filter(Boolean);
  return {
    text: `Vehicle signed in — ${b.booking_name}`,
    blocks: [
      section(
        `*🏁 Signed in — ${b.booking_name}*\n${c.assigned.map((a) => a.name).join(", ") || "Vehicle"} · ${headline(b)}\n${lines.join("\n")}`
      ),
      {
        type: "actions",
        block_id: `vh:${b.id}`,
        elements: [
          { type: "button", action_id: VH_COMPLETE, style: "primary", text: { type: "plain_text", text: "Mark completed" }, value: b.id },
          openButton(b.id),
        ],
      },
    ],
  };
}

export type VehicleSlackEvent = "requested" | "collected" | "returned" | "cancelled" | "paid" | "signed";

/** One entry point for every lifecycle moment. Never throws. */
export async function notifyVehicleSlack(
  event: VehicleSlackEvent,
  bookingId: string,
  extra?: { amountCents?: number; xeroInvoiceNumber?: string | null; signerName?: string | null }
): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;
  try {
    const admin = createAdminClient() as Client;
    const c = await loadCtx(admin, bookingId);
    if (!c) return;
    const { b } = c;
    const vehicles = c.assigned.map((a) => `${a.name}${a.plate ? ` (${a.plate})` : ""}`).join(", ") || "No vehicle assigned";
    const link = context(`<${bookingUrl(b.id)}|Open the booking in the Hub>`);

    switch (event) {
      case "requested":
        await postTracked(admin, b.id, "request", requestOpenMessage(c));
        return;
      case "returned":
        await postTracked(admin, b.id, "returned", returnedMessage(c));
        return;
      case "collected": {
        const out = [...c.inspections].reverse().find((i) => i.kind === "collection");
        await postFyi(admin, {
          text: `Vehicle signed out — ${b.booking_name}`,
          blocks: [
            section(
              `*🔑 Signed out — ${b.booking_name}*\n${vehicles} · back ${dateRangeLabel(b.return_date, null)}\n${[
                out?.driver_names ? `*Drivers:* ${out.driver_names}` : null,
                ...inspectionLines(out),
                moneyLine(b),
              ]
                .filter(Boolean)
                .join("\n")}`
            ),
            link,
          ],
        });
        return;
      }
      case "cancelled":
        await refreshVehicleRequestAlerts(b.id);
        await postFyi(admin, {
          text: `Vehicle booking cancelled — ${b.booking_name}`,
          blocks: [section(`*🚫 Cancelled — ${b.booking_name}*\n${headline(b)} · ${vehicles} is free again`), link],
        });
        return;
      case "paid":
        await postFyi(admin, {
          text: `Vehicle payment received — ${b.booking_name}`,
          blocks: [
            section(
              `*💳 Payment received — ${b.booking_name}*\n${extra?.amountCents != null ? randsLabel(extra.amountCents) : "Paid"}${
                extra?.xeroInvoiceNumber ? ` · Xero ${extra.xeroInvoiceNumber}` : ""
              } · pickup ${dateRangeLabel(b.checkout_date, null)}`
            ),
            link,
          ],
        });
        return;
      case "signed":
        await postFyi(admin, {
          text: `Vehicle agreement signed — ${b.booking_name}`,
          blocks: [
            section(`*✍️ Agreement signed — ${b.booking_name}*\n${extra?.signerName ?? "The renter"} signed the vehicle policy · ${headline(b)}`),
            link,
          ],
        });
        return;
    }
  } catch (err) {
    console.error("[vehicles/slack] notify failed", event, err);
  }
}

// ── 07:00 digest ────────────────────────────────────────────

const sastToday = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Row = VehicleBookingWithRefs & { inspections?: { kind: string }[] | null };

const rowLine = (b: Row, tail?: string) => {
  const v = (b.assignments ?? []).map((a) => a.vehicle?.name).filter(Boolean).join(", ");
  return `• <${bookingUrl(b.id)}|${b.booking_name}>${v ? ` · ${v}` : ""}${b.requester_name ? ` · ${b.requester_name}` : ""}${tail ? ` · ${tail}` : ""}`;
};

/** The morning summary. Sends nothing on a quiet day. */
export async function sendVehicleDigest(): Promise<{ sent: boolean; items: number }> {
  if (!process.env.SLACK_BOT_TOKEN) return { sent: false, items: 0 };
  const admin = createAdminClient() as Client;
  const today = sastToday();
  const select =
    "*, assignments:vehicle_booking_assignments(vehicle:vehicles(name)), inspections:vehicle_inspections(kind)";

  const [pickupsRes, returnsRes, overdueRes, unpaidRes, waitingRes] = await Promise.all([
    admin.from("vehicle_bookings").select(select).eq("status", "approved").eq("checkout_date", today),
    admin.from("vehicle_bookings").select(select).eq("status", "approved").eq("return_date", today),
    admin.from("vehicle_bookings").select(select).eq("status", "approved").lt("return_date", today),
    admin
      .from("vehicle_bookings")
      .select(select)
      .eq("status", "approved")
      .eq("payment_required", true)
      .eq("payment_received", false)
      .gte("checkout_date", today)
      .lte("checkout_date", addDays(today, 2)),
    admin
      .from("vehicle_bookings")
      .select(select)
      .eq("status", "pending")
      .lt("created_at", new Date(Date.now() - 2 * 86400 * 1000).toISOString()),
  ]);
  const has = (b: Row, kind: string) => (b.inspections ?? []).some((i) => i.kind === kind);

  const pickups = (pickupsRes.data ?? []) as Row[];
  const returns = (returnsRes.data ?? []) as Row[];
  const pastReturn = (overdueRes.data ?? []) as Row[];
  const overdue = pastReturn.filter((b) => !has(b, "return"));
  const toComplete = pastReturn.filter((b) => has(b, "return"));
  const unpaid = (unpaidRes.data ?? []) as Row[];
  const waiting = (waitingRes.data ?? []) as Row[];

  const parts: string[] = [];
  if (overdue.length)
    parts.push(`*🚨 Overdue (${overdue.length})*\n${overdue.map((b) => rowLine(b, `was due ${dateRangeLabel(b.return_date, null)}`)).join("\n")}`);
  if (pickups.length) parts.push(`*🔑 Pickups today (${pickups.length})*\n${pickups.map((b) => rowLine(b, has(b, "collection") ? "signed out" : undefined)).join("\n")}`);
  if (returns.length) parts.push(`*🏁 Due back today (${returns.length})*\n${returns.map((b) => rowLine(b, has(b, "return") ? "signed in" : undefined)).join("\n")}`);
  if (unpaid.length)
    parts.push(`*💳 Unpaid, pickup within 2 days (${unpaid.length})*\n${unpaid.map((b) => rowLine(b, `pickup ${dateRangeLabel(b.checkout_date, null)}`)).join("\n")}`);
  if (waiting.length) parts.push(`*⏳ Waiting on a decision 2+ days (${waiting.length})*\n${waiting.map((b) => rowLine(b, headline(b))).join("\n")}`);
  if (toComplete.length) parts.push(`*✔️ Signed in, not marked completed (${toComplete.length})*\n${toComplete.map((b) => rowLine(b)).join("\n")}`);

  const items = overdue.length + pickups.length + returns.length + unpaid.length + waiting.length + toComplete.length;
  if (items === 0) return { sent: false, items: 0 };

  await postFyi(admin, {
    text: `Vehicles today — ${items} thing${items === 1 ? "" : "s"} to know`,
    blocks: [
      section(`*🚐 Vehicles — ${dateRangeLabel(today, null)}*`),
      ...parts.map(section),
      context(`<${SITE}/bookings/vehicles|Open the vehicle board>`),
    ],
  });
  return { sent: true, items };
}
