// The Training page (Rent a Vehicle → Training): a booking from the form to completed, on
// made-up people. Every message comes from scenario.json, which the simulation
// (rental-flow.simulation.test.ts) writes from the Hub's real code, so the training can't
// drift from what people actually receive. This file only adds the plain-language notes
// for each moment: what the person booking sees, and what the coordinator does.

import scenario from "./scenario.json";

export type TrainingEvent = {
  kind: "slack" | "slack-update" | "modal" | "email";
  to: string;
  text: string;
  subject?: string;
  html?: string;
  blocks?: Record<string, unknown>[];
};

export type TrainingStep = {
  at: string; // "2026-11-30 06:30", South African time
  title: string;
  short: string; // the step list
  booking: "A" | "B";
  booker: string; // what the person booking (and the drivers) see or do
  coordinator: string; // the coordinator's part, behind the scenes
  events: TrainingEvent[];
};

/** Who a message is for, so the page can sort it into the right column. */
export const isCoordinator = (e: TrainingEvent) => /coordinator/i.test(e.to);

type Note = Omit<TrainingStep, "at" | "title" | "events">;

// Keyed by the simulation's step titles. scriptSteps() throws on a title with no note, and
// training.test.ts checks every one, so a renamed step can't silently lose its words.
export const NOTES: Record<string, Note> = {
  "Thandi sends the request": {
    short: "Request sent",
    booking: "A",
    booker:
      "Thandi gets a receipt on Slack and by email. The booking shows as pending under My requests until the coordinator decides.",
    coordinator:
      "You get the request in Slack: the dates, the vehicles, every driver with their licence check, and Approve or Deny. You can also change the vehicles from the message.",
  },
  "The coordinator taps Approve": {
    short: "Approved",
    booking: "A",
    booker: "Thandi is told on Slack and by email that the booking is approved.",
    coordinator:
      "Tap Approve. The Hub re-checks every driver's licence first and refuses if one has expired or a licence photo is missing. Your Slack message updates to show it's approved.",
  },
  "Pick-up day: instructions go out": {
    short: "Pick-up day",
    booking: "A",
    booker:
      "At 06:30 the person who booked gets their own instructions plus the driver instructions. Drivers on the Hub get Slack and email; drivers who aren't get email. A driver with no email: the person who booked is asked to pass it on.",
    coordinator:
      "Nothing is sent to you. The person who booked contacts you to arrange a pick-up time between 07:00 and 17:00, and you hand over the keys.",
  },
  "Booking B picked up": {
    short: "B: pick-up day",
    booking: "B",
    booker: "Jonah booked the Kombi and drives it himself, so he gets one message: his instructions and the driver instructions.",
    coordinator: "Nothing is sent to you. Same as booking A: hand over the keys at the time you agreed.",
  },
  "The day before: reminder": {
    short: "Day before",
    booking: "A",
    booker:
      "At 07:00 the day before it's due back, everyone on the booking gets a reminder. People on the Hub have a Return early button; people who aren't get the coordinator's number.",
    coordinator: "Nothing to do. If someone wants to return early, you'll get a request (see booking B).",
  },
  "Return early: Jonah asks on the Hub": {
    short: "B: asks to return early",
    booking: "B",
    booker: "Jonah taps Return early (in the reminder, or on the booking page) and picks the day he'll bring it back.",
    coordinator: "You get the request in Slack with two buttons: Approve, or I'll call them.",
  },
  "The coordinator taps Approve (early return)": {
    short: "B: early return approved",
    booking: "B",
    booker: "Jonah is told the new due-back day. The reminders now follow that day.",
    coordinator:
      "Tap Approve and the due-back day moves for you. If it doesn't suit, tap I'll call them, and Jonah is told you'll be in touch.",
  },
  "Due-back day: return instructions + coordinator's Returned message": {
    short: "Due-back day",
    booking: "A",
    booker:
      "At 07:00 everyone gets the return instructions: back before 12:00, washed, full tank, photos, nothing left behind, keys handed in.",
    coordinator:
      "You get a Slack message saying it's due back today, with a Returned button. Tap it when the vehicle is back. Booking A is an international team, so the message also says: book a full valet wash as soon as it's back.",
  },
  "The coordinator taps Returned": {
    short: "Returned",
    booking: "A",
    booker: "Nothing new. The booking stays open until the inspections are done.",
    coordinator:
      "Your message changes to Returned, and a new one arrives: the post-rental inspection, with a link to Fleet for each vehicle, and the valet reminder again.",
  },
  "Post-rental inspection saved: Nissan Almera": {
    short: "Inspection 1 of 2",
    booking: "A",
    booker: "Nothing yet.",
    coordinator:
      "Open the link and do the post-rental inspection in Fleet. When you save it, the Slack message ticks the Almera off. The booking waits for the CR-V.",
  },
  "Post-rental inspection saved: Honda CR-V → booking completed": {
    short: "Completed",
    booking: "A",
    booker: "Thandi is told on Slack and by email that the booking is complete.",
    coordinator:
      "Save the second inspection and the booking completes by itself. Mark completed won't work before every vehicle's inspection is saved.",
  },
  "Someone tries to book the Almera during the hold": {
    short: "The hold",
    booking: "A",
    booker:
      "Booking A was an international team, so its cars stay with us for 3 working days after they're due back: Sat 5 to Wed 9 Dec, the weekend included. Anyone booking them for those days is told they aren't available. From Thu 10 Dec they're free.",
    coordinator:
      "Use the hold for the post-rental inspection and the full valet wash. If you need the cars sooner, open booking A and tap Release the hold. You have to write why, and the cars are free at once.",
  },
  "Booking B due back on the earlier day": {
    short: "B: due back early",
    booking: "B",
    booker: "Jonah gets the return instructions on the new day.",
    coordinator: "You get the Returned message for the Kombi, and it carries on like booking A.",
  },
};

// Two steps share the title "The coordinator taps Approve"; the second is the early return.
const noteKey = (title: string, seen: Set<string>) => {
  const key = seen.has(title) && title === "The coordinator taps Approve" ? `${title} (early return)` : title;
  seen.add(title);
  return key;
};

export function scriptSteps(): TrainingStep[] {
  const seen = new Set<string>();
  return (scenario.steps as { at: string; title: string; events: TrainingEvent[] }[]).map((s) => {
    const key = noteKey(s.title, seen);
    const note = NOTES[key];
    if (!note) throw new Error(`Training: no note for "${key}"`);
    return { at: s.at, title: key === s.title ? s.title : "The coordinator approves the early return", events: s.events, ...note };
  });
}

/** The made-up people, for the cast list. */
export const CAST = [
  { name: "Thandi Mokoena", part: "Booked A and drives. On the Hub and Slack." },
  { name: "Sam Taylor", part: "Driver on A. Not on the Hub; email on the booking." },
  { name: "Lee Chen", part: "Driver on A. No email on the booking." },
  { name: "Jonah Peters", part: "Booked B and drives. On the Hub and Slack." },
  { name: "Pieter", part: "Vehicle Coordinator. Gets the Slack messages and does the inspections." },
];
