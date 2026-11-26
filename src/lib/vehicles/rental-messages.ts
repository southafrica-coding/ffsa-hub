// The standard messages for every vehicle booking (Gideon, 24 Nov 2026). One wording for
// every vehicle: the Hub fills in the booking's names, dates, vehicles and fuel, and the
// Vehicle Coordinator's name and number. Nothing here is edited per vehicle.
//
//   • pickup-point   — pick-up day, to the person who booked (the point person)
//   • pickup-driver  — pick-up day, to each driver: checks before you drive, driving in SA
//   • return-before  — 07:00 the day before it's due back: a reminder, and Return early
//   • return-day     — 07:00 the day it's due back: what to do before you hand it back
//
// Pure: each returns a subject and blocks; toSlack / toEmailHtml render them. The
// scheduler (rental-schedule.ts) decides who gets what, when.

import { renderEmailShell, escapeHtml } from "@/lib/email/shell";

export type RentalMessageKind = "pickup-point" | "pickup-driver" | "return-before" | "return-day";

export interface RentalVehicle {
  name: string;
  reg?: string | null;
  fuel?: "diesel" | "petrol" | string | null;
}
export interface RentalContext {
  firstName: string;
  bookingName: string;
  vehicles: RentalVehicle[];
  /** Pick-up day (checkout_date). */
  collect: string;
  /** Last day the vehicle is needed (return_date). */
  lastDay: string;
  /** Due back before 12:00 (due_back_date: the day after the last day). */
  dueBack: string;
  bookingUrl: string;
  coordinator: { name: string; phone: string };
  /** For the point person: the booking's drivers, and whether we could message them. */
  drivers?: { name: string; reached: boolean }[];
  /** Hub users get a Return early button; email-only drivers get the coordinator's number. */
  canReturnEarly?: boolean;
}

/** *bold* as in Slack; `ul` is a bullet list; `ol` numbered; `h` a section heading. */
export type Block = { h: string } | { p: string } | { ul: string[] } | { ol: string[] };
export interface RentalMessage {
  kind: RentalMessageKind;
  subject: string;
  /** Short line for notifications and the email preheader. */
  preview: string;
  blocks: Block[];
  /** A button (Slack) / link (email). */
  action?: { label: string; url: string; id?: string };
}

// ── Formatting ─────────────────────────────────────────────

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** "Wednesday, 25 November" */
export const fmtLong = (iso: string) => DAY.format(new Date(iso + "T00:00:00Z")).replace(/^(\w+) /, "$1, ");

export const fuelLabel = (f: RentalVehicle["fuel"]) =>
  f === "diesel" ? "DIESEL" : f === "petrol" ? "PETROL (unleaded)" : "the fuel written inside the fuel flap";
const fuelWord = (f: RentalVehicle["fuel"]) => (f === "diesel" ? "Diesel" : f === "petrol" ? "Unleaded" : "The right fuel");
const vehicleName = (v: RentalVehicle) => `*${v.name}*${v.reg ? ` (${v.reg})` : ""}`;
const vehiclesLine = (c: RentalContext) => c.vehicles.map(vehicleName).join(" and ") || "your vehicle";
const one = (c: RentalContext) => c.vehicles.length <= 1;
const it = (c: RentalContext) => (one(c) ? "it" : "them");
const theVehicle = (c: RentalContext) => (one(c) ? "the vehicle" : "the vehicles");
const coordinatorLine = (c: RentalContext) => `${c.coordinator.name}, ${c.coordinator.phone}`;

// ── Shared sections ────────────────────────────────────────

const fuelBlocks = (c: RentalContext): Block[] => [
  { h: "⛽ AT THE PETROL STATION" },
  { p: "In South Africa an attendant fills the vehicle for you. You stay in the vehicle." },
  {
    ul: [
      ...c.vehicles.map((v) =>
        one(c)
          ? `*This vehicle takes ${fuelLabel(v.fuel)}. Never put in anything else.* Say “${fuelWord(v.fuel)}, full please” or give a Rand amount.`
          : `${vehicleName(v)} takes *${fuelLabel(v.fuel)}*. Never put in anything else.`
      ),
      ...(one(c) ? [] : ["Say “Diesel, full please” or “Unleaded, full please”, or give a Rand amount."]),
      "Ask: *“Please check the oil, water and tyre pressure.”* They’ll also clean the windscreen if you ask.",
    ],
  },
];

const emergencyBlocks = (c: RentalContext): Block[] => [
  { h: "IN AN EMERGENCY" },
  {
    ul: [
      "Pull over well off the road, switch on the hazard lights, and put the triangle 15–20 m behind the vehicle.",
      `Then call the Vehicle Coordinator straight away: ${coordinatorLine(c)}`,
    ],
  },
];

const returnRule = (c: RentalContext) =>
  `Bring ${theVehicle(c)} back on *${fmtLong(c.dueBack)}, before 12:00*: washed inside and out, with a full tank, and with the return checks done.`;

const afterTripBlocks = (c: RentalContext): Block[] => [
  { h: "BEFORE YOU HAND IT BACK" },
  {
    ol: [
      `*Wash ${theVehicle(c)}* inside and out (vacuum the inside, clean the windows). Keep the receipt if you use a car wash.`,
      `*Fill the tank* with ${one(c) ? fuelLabel(c.vehicles[0]?.fuel) : "the right fuel for each vehicle"}.`,
      "📸 Send the Vehicle Coordinator a photo of the *km reading* and *fuel gauge* on the dashboard.",
      "📸 Send photos of any *new* damage, inside or out, even small scratches or chips. Mistakes happen, and it’s much better that we know.",
      "Tell the Vehicle Coordinator:\n   • Did anything feel, sound or smell different (noises, brakes, steering pulling to one side, vibration)?\n   • Did any warning light come on?\n   • Did you hit any big potholes or kerbs?\n   • Did anything break or stop working?",
      "Check nothing is left inside (under the seats, door pockets, boot or back doors). Make sure all the keys come back. Lock it and check every door and the boot are locked.",
    ],
  },
];

// ── The messages ───────────────────────────────────────────

/** Pick-up day, to each driver: the checks before driving, and driving in South Africa. */
export function pickupDriverMessage(c: RentalContext): RentalMessage {
  return {
    kind: "pickup-driver",
    subject: `Today you collect ${c.vehicles.map((v) => v.name).join(" and ")}: checks before you drive`,
    preview: `Pick-up today. Please do these checks before you drive off.`,
    blocks: [
      { p: `Hi ${c.firstName} 👋` },
      { p: `Today you collect ${vehiclesLine(c)} for *${c.bookingName}*. ${returnRule(c)}` },
      { p: `Please do these quick checks before you drive off, and before each trip while you have ${it(c)}. They’re mostly just looking, take about 5 minutes, and keep you safe. Anything you can’t check yourself, a petrol attendant can do for you (see below).` },
      { h: "🇿🇦 DRIVING IN SOUTH AFRICA" },
      {
        ul: [
          "*We drive on the LEFT side of the road.*",
          "*Speed limits.* These are only guidelines; always follow the signs posted next to the road:\n   • *60 km/h* in town (*30–40 km/h* in neighbourhoods)\n   • *80–100 km/h* on the open road\n   • *120 km/h* on national highways",
        ],
      },
      { h: "BEFORE EACH TRIP" },
      { p: "*1. Walk around the vehicle*\nWalk slowly all the way round, about one step away. Crouch down to see the lower parts. Look for dents, scratches, cracked lights or mirrors.\n📸 Photograph anything you notice *before you drive*, close up and once from further back, and send it to the Vehicle Coordinator. Then nobody can blame you for damage that was already there." },
      { p: "*2. Tyres (including the spare)*" },
      {
        ul: [
          "All four should look the same: round, with only a slight bulge at the bottom. If one looks flatter, have it checked before you leave.",
          "Look at the sides for cuts, bulges or nails. Turn the steering wheel all the way to see the inside of the front tyres.",
          "The correct pressure is usually on a sticker inside the driver’s door frame or the fuel flap. A petrol attendant can check and pump them.",
        ],
      },
      { p: "*3. Lights*\nSwitch on the headlights and hazard lights and walk round: every light and indicator should work. For the brake lights, ask someone to watch while you press the brake." },
      { p: "*4. Windscreen, wipers and mirrors*" },
      { ul: ["No cracks in front of the driver.", "Wipers clear the glass without smearing. Test with the washer spray.", "Mirrors are clean, not cracked, and set for you."] },
      { p: "*5. Inside the vehicle*" },
      {
        ul: [
          "*Warning lights:* when you start the engine, the lights on the dashboard come on for a few seconds and then go off. If any stay on, take a photo and send it to the Vehicle Coordinator before you go. Red = don’t drive. Orange = tell us.",
          "*Seat belts:* at every seat, pull the belt quickly (it should lock), let go (it should roll back in), and buckle it (it should hold).",
          "*Handbrake:* it should hold the vehicle still on a slope.",
          "*Licence disc:* the round paper disc on the windscreen must be there and not expired.",
          "Every driver carries their driver’s licence.",
        ],
      },
      { p: "*6. Safety kit*\nCheck that the *red warning triangle*, the *jack*, the *wheel spanner* and the *spare wheel* are in the vehicle. You legally need the triangle in South Africa." },
      { p: "*7. Under the bonnet (or ask the petrol attendant)*\nOnly check with the engine off, on level ground. *Never open the radiator cap when the engine is hot.*" },
      {
        ul: [
          "*Oil:* pull out the dipstick (a yellow or orange loop), wipe it, push it back in, pull it out. The level should be between the two marks. Golden-brown is good. Very black means it’s due a service, so tell us. Milky means don’t drive, call the Vehicle Coordinator.",
          "*Coolant (“water”):* the see-through plastic tank should be between MIN and MAX.",
          "*Leaks:* look at the ground where the vehicle was parked. Drips of oil (black or brown) or coolant (green, pink or orange) mean tell us. Clear water under the front is normal (it’s from the aircon).",
        ],
      },
      ...fuelBlocks(c),
      ...emergencyBlocks(c),
      { h: "RETURNING THE VEHICLE" },
      { p: `${returnRule(c)} You’ll get a reminder the day before, and the return checks that morning.` },
      { p: "Safe travels, and thank you! 🙏\nFFSA Fleet" },
    ],
    action: { label: "Booking details", url: c.bookingUrl },
  };
}

/** Pick-up day, to the person who booked: their part of the handover. */
export function pickupPointMessage(c: RentalContext): RentalMessage {
  const drivers = c.drivers || [];
  const unreached = drivers.filter((d) => !d.reached).map((d) => d.name);
  return {
    kind: "pickup-point",
    subject: `Pick-up today: ${c.vehicles.map((v) => v.name).join(" and ")} for ${c.bookingName}`,
    preview: `Your vehicle pick-up is today. Here's what you're responsible for.`,
    blocks: [
      { p: `Hi ${c.firstName} 👋` },
      { p: `Your booking *${c.bookingName}* starts today: ${vehiclesLine(c)}. As the person who booked, you’re the point person for ${theVehicle(c)} until ${one(c) ? "it’s" : "they’re"} back.` },
      { h: "TODAY" },
      {
        ol: [
          `*Arrange the pick-up time* with the Vehicle Coordinator (pick-ups are between 07:00 and 17:00): ${coordinatorLine(c)}`,
          "*Bring every driver’s driver’s licence.* Only the drivers on the booking may drive.",
          `*At the handover*, walk round ${theVehicle(c)} with the Vehicle Coordinator and photograph anything already damaged before you drive off.`,
          drivers.length
            ? unreached.length
              ? `*Make sure every driver has the driver instructions.* We sent them to ${drivers.length - unreached.length} of ${drivers.length} drivers. *${unreached.join(", ")}* ${unreached.length === 1 ? "has" : "have"} no email on the booking, so please forward them the driver instructions (below).`
              : `*Every driver on the booking has been sent the driver instructions* by email${drivers.length ? " (and Slack, if they’re on the Hub)" : ""}. Please check they’ve read them.`
            : "*Share the driver instructions* (below) with everyone who will drive.",
        ],
      },
      { h: "WHILE YOU HAVE IT" },
      {
        ul: [
          "Only the drivers on the booking drive.",
          "Anything goes wrong (a warning light, a breakdown, an accident, damage): call the Vehicle Coordinator straight away.",
        ],
      },
      { h: "RETURNING IT" },
      { p: `${returnRule(c)} The day before, you’ll get a reminder, with the option to return it earlier.` },
      { p: "Driver instructions (the same as the drivers received):" },
      ...pickupDriverMessage(c).blocks.slice(3, -1),
      { p: "Thank you! 🙏\nFFSA Fleet" },
    ],
    action: { label: "Booking details", url: c.bookingUrl },
  };
}

/** 07:00 the day before it's due back: a reminder, and the option to return it earlier. */
export function returnBeforeMessage(c: RentalContext): RentalMessage {
  return {
    kind: "return-before",
    subject: `Reminder: ${c.vehicles.map((v) => v.name).join(" and ")} is due back tomorrow before 12:00`,
    preview: `Due back tomorrow before 12:00, washed and refuelled.`,
    blocks: [
      { p: `Hi ${c.firstName} 👋` },
      { p: `A reminder: ${vehiclesLine(c)} for *${c.bookingName}* ${one(c) ? "is" : "are"} due back *tomorrow, ${fmtLong(c.dueBack)}, before 12:00*.` },
      { p: "Please plan for:" },
      { ul: [`Washing ${theVehicle(c)} inside and out.`, "Filling the tank.", "The return checks. You’ll get the list tomorrow morning."] },
      { h: "DONE EARLIER?" },
      {
        p: c.canReturnEarly
          ? `If you can bring ${it(c)} back earlier, tap *Return early* and choose the day. The Vehicle Coordinator will confirm.`
          : `If you can bring ${it(c)} back earlier, contact the Vehicle Coordinator: ${coordinatorLine(c)}`,
      },
      { p: "Thank you! 🙏\nFFSA Fleet" },
    ],
    action: c.canReturnEarly ? { label: "Return early", url: `${c.bookingUrl}?return-early=1`, id: "return-early" } : { label: "Booking details", url: c.bookingUrl },
  };
}

/** 07:00 the day it's due back: what to do before handing it back. */
export function returnDayMessage(c: RentalContext): RentalMessage {
  return {
    kind: "return-day",
    subject: `${c.vehicles.map((v) => v.name).join(" and ")} is due back today before 12:00`,
    preview: `Due back today before 12:00. Here's what to do before you hand it back.`,
    blocks: [
      { p: `Hi ${c.firstName} 👋` },
      { p: `${vehiclesLine(c)} for *${c.bookingName}* ${one(c) ? "is" : "are"} due back *today, before 12:00*.` },
      ...afterTripBlocks(c),
      { p: `Then hand the keys to the Vehicle Coordinator. If you can’t make 12:00, let them know as soon as possible: ${coordinatorLine(c)}` },
      { p: "Thank you for looking after it! 🙏\nFFSA Fleet" },
    ],
    action: { label: "Booking details", url: c.bookingUrl },
  };
}

export function rentalMessage(kind: RentalMessageKind, c: RentalContext): RentalMessage {
  switch (kind) {
    case "pickup-point":
      return pickupPointMessage(c);
    case "pickup-driver":
      return pickupDriverMessage(c);
    case "return-before":
      return returnBeforeMessage(c);
    case "return-day":
      return returnDayMessage(c);
  }
}

// ── Rendering ──────────────────────────────────────────────

/** Slack mrkdwn (also reads well as plain text, e.g. WhatsApp later). */
export function toSlackText(m: RentalMessage): string {
  return m.blocks
    .map((b) =>
      "h" in b ? `*${b.h}*` : "p" in b ? b.p : "ul" in b ? b.ul.map((l) => `• ${l}`).join("\n") : b.ol.map((l, i) => `${i + 1}. ${l}`).join("\n")
    )
    .join("\n\n");
}

const inline = (s: string) =>
  escapeHtml(s)
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
    .replace(/\n {3}• /g, "<br/>&nbsp;&nbsp;&nbsp;• ")
    .replace(/\n/g, "<br/>");

export function toEmailHtml(m: RentalMessage, siteUrl: string): string {
  const P = "margin:0 0 14px 0;font-size:15px;line-height:1.55;";
  const body = m.blocks
    .map((b) =>
      "h" in b
        ? `<p style="margin:22px 0 8px 0;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">${inline(b.h)}</p>`
        : "p" in b
          ? `<p style="${P}">${inline(b.p)}</p>`
          : `<${"ul" in b ? "ul" : "ol"} style="margin:0 0 14px 20px;padding:0;font-size:15px;line-height:1.55;">${("ul" in b ? b.ul : b.ol)
              .map((l) => `<li style="margin:0 0 6px 0;">${inline(l)}</li>`)
              .join("")}</${"ul" in b ? "ul" : "ol"}>`
    )
    .join("");
  const EYEBROW: Record<RentalMessageKind, string> = {
    "pickup-point": "Pick-up today",
    "pickup-driver": "Pick-up today",
    "return-before": "Due back tomorrow",
    "return-day": "Due back today",
  };
  return renderEmailShell({
    title: m.subject,
    preheader: m.preview,
    eyebrow: EYEBROW[m.kind],
    heading: m.subject,
    bodyHtml: body,
    cta: m.action ? { label: m.action.label, url: m.action.url } : undefined,
    siteUrl,
  });
}
