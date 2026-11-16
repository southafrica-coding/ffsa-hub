import { describe, expect, it } from "vitest";
import { ACTIVITIES, parseHelperAnswers, summariseAnswers, summaryText, type HelperAnswers } from "./helper";

const TODAY = "2026-11-10";

const base = {
  eventType: "wedding",
  date: "2026-12-12",
  setting: "indoor",
  venueSize: "hall",
  power: "yes",
  guests: "150",
  activities: ["speeches"],
  soundTech: "no",
  fulfilment: "collect",
  name: "Thandi Mokoena",
  email: "Thandi@Example.com",
  phone: "082 555 0100",
};

function answers(extra: Record<string, unknown> = {}): HelperAnswers {
  const r = parseHelperAnswers({ ...base, ...extra }, TODAY);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe("parseHelperAnswers", () => {
  it("accepts the required answers and tidies them", () => {
    const a = answers({ speakers: "", eventName: "" });
    expect(a.guests).toBe(150);
    expect(a.email).toBe("thandi@example.com");
    expect(a.speakers).toBeUndefined();
    expect(a.eventName).toBeUndefined();
  });

  it("names the first missing required answer", () => {
    expect(parseHelperAnswers({ ...base, guests: "" }, TODAY)).toEqual({ ok: false, error: "Tell us roughly how many people are coming." });
    expect(parseHelperAnswers({ ...base, activities: [] }, TODAY)).toMatchObject({ ok: false, error: expect.stringMatching(/at least one/) });
    expect(parseHelperAnswers({ ...base, email: "nope" }, TODAY)).toMatchObject({ ok: false, error: "Check your email address." });
  });

  it("has no DJ option", () => {
    expect(ACTIVITIES.map((a) => a.value)).not.toContain("dj");
    expect(parseHelperAnswers({ ...base, activities: ["dj"] }, TODAY).ok).toBe(false);
  });

  it("refuses unknown fields", () => {
    expect(parseHelperAnswers({ ...base, status: "confirmed" }, TODAY).ok).toBe(false);
  });

  it("refuses past, backwards and overlong dates", () => {
    expect(parseHelperAnswers({ ...base, date: "2026-11-01" }, TODAY).ok).toBe(false);
    expect(parseHelperAnswers({ ...base, endDate: "2026-12-10" }, TODAY).ok).toBe(false);
    expect(parseHelperAnswers({ ...base, date: "2026-12-01", endDate: "2027-02-01" }, TODAY).ok).toBe(false);
  });

  it("asks what the event is when they chose something else", () => {
    expect(parseHelperAnswers({ ...base, eventType: "other" }, TODAY).ok).toBe(false);
    expect(parseHelperAnswers({ ...base, eventType: "other", eventTypeOther: "Prayer walk" }, TODAY).ok).toBe(true);
  });
});

describe("summariseAnswers", () => {
  it("counts speech mics by who talks at once, plus one per singer", () => {
    const s = summariseAnswers(answers({ activities: ["speeches", "worship"], speakers: 6, speakersAtOnce: 2, vocalists: 3 }));
    expect(s.counts).toContain("Microphones: about 5 (2 speech mics, 3 vocal mics)");
  });

  it("lists instruments and shows the band section only when there are musicians", () => {
    const band = summariseAnswers(
      answers({ activities: ["live_band"], instruments: ["drums", "keys", "other"], instrumentsOther: "Cajon" })
    );
    expect(band.counts).toContain("Instruments to plug in or mic: Drum kit, Keyboard or piano, Cajon");
    expect(band.sections.map((x) => x.title)).toContain("The band");

    const talk = summariseAnswers(answers({ instruments: ["drums"] }));
    expect(talk.sections.map((x) => x.title)).not.toContain("The band");
  });

  it("flags what the rental manager should see first", () => {
    const s = summariseAnswers(
      answers({ setting: "outdoor", venueSize: "open_field", covered: "no", power: "no", guests: 2000, soundTech: "yes", fulfilment: "delivery" })
    );
    expect(s.flags).toEqual([
      "No power at the venue",
      "Outdoors with no cover for the gear",
      "Large crowd: about 2000 people",
      "Wants someone from our team to run the sound",
      "Wants delivery",
    ]);
  });

  it("leaves unanswered questions out and writes plain text for the order", () => {
    const text = summaryText(summariseAnswers(answers()));
    expect(text).toContain("- Type: Wedding");
    expect(text).toContain("- Phone: 082 555 0100");
    expect(text).not.toContain("Vocalists");
    expect(text).not.toContain("Cover for the gear");
  });
});
