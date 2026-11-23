"use client";

import { useState } from "react";
import { missioSkinVars } from "@/components/missio/access";
import { missioBody, missioDisplay } from "@/components/missio/fonts";
import { MissioPublicMark } from "@/components/missio/public-mark";
import type { PlacementView } from "@/lib/missio/placements";
import connect from "../connect/connect.module.css";
import { telHref, whatsAppHref } from "../follow-up/whatsapp";
import { PlacementSteps, shortDate } from "./steps";
import styles from "./placements.module.css";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const dayLong = new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function houseTitle(house: PlacementView["house"]): string {
  return house.name?.trim() || `House ${house.number}`;
}

function dayName(day: string | null): string {
  return day ? day.charAt(0).toUpperCase() + day.slice(1) : "";
}

/** The next meeting on or after today. */
function nextMeeting(day: string | null, now = new Date()): string | null {
  const target = DAYS.indexOf((day ?? "").toLowerCase());
  if (target < 0) return null;
  const date = new Date(`${now.toISOString().slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((target - date.getUTCDay() + 7) % 7));
  return dayLong.format(date);
}

function Shell({ children, state }: { children: React.ReactNode; state: string }) {
  return (
    <main className={`${missioBody.variable} ${missioDisplay.variable} ${missioBody.className} ${connect.page}`} style={missioSkinVars()} data-skin="missio" data-placement={state}>
      <div className={connect.column}>
        <MissioPublicMark />
        {children}
      </div>
    </main>
  );
}

export function PlacementStatus({ state }: { state: "invalid" | "limited" | "unavailable" }) {
  const copy = {
    invalid: { title: "This link doesn’t work", body: "Ask whoever sent it to send it again." },
    limited: { title: "Too many tries", body: "Wait a minute, then open the link again." },
    unavailable: { title: "Missio didn’t load this", body: "Try again in a minute." },
  }[state];
  return (
    <Shell state={state}>
      <h1>{copy.title}</h1>
      <p className={connect.lede}>{copy.body}</p>
    </Shell>
  );
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** Board M12b: the person's own next-steps page. */
export function PersonNextSteps({ token, view, send = post }: { token: string; view: PlacementView; send?: typeof post }) {
  const [cant, setCant] = useState(Boolean(view.cantMakeItAt));
  const [error, setError] = useState<string | null>(null);
  const first = view.person.name.split(" ")[0] || "there";
  const leaders = view.leaders.map((leader) => leader.name.split(" ")[0]).filter(Boolean);
  const next = nextMeeting(view.house.meetingDay);
  return (
    <Shell state="person">
      <h1>
        Hi {first}, welcome to {houseTitle(view.house)}
      </h1>
      <div className={styles.card}>
        <PlacementSteps view={view} />
      </div>
      <div className={styles.card}>
        {view.house.meetingDay ? <p className={styles.bigLine}>{dayName(view.house.meetingDay)}s</p> : null}
        {next ? <p>Next: {next}</p> : null}
        {view.house.location ? (
          <>
            <p className={styles.bigLine}>{view.house.location}</p>
            <p>
              <a href={`https://maps.google.com/?q=${encodeURIComponent(view.house.location)}`} target="_blank" rel="noopener noreferrer">
                Open in Maps
              </a>
            </p>
          </>
        ) : (
          <p>You’ll get the address once your leader has said hi.</p>
        )}
      </div>
      {leaders.length > 0 ? (
        <div className={styles.card}>
          <p className={styles.bigLine}>{leaders.join(" & ")}</p>
          <p>your house church {leaders.length > 1 ? "leaders" : "leader"}</p>
        </div>
      ) : null}
      <p className={connect.lede}>
        What to expect: a meal together, worship, a short time in the Bible and prayer. Come as you are. Nobody will put you on the spot.
      </p>
      {!view.joinedAt ? (
        cant ? (
          <p className={connect.lede} role="status">
            Thanks for letting us know. Your leader knows, and we’ll see you next week.
          </p>
        ) : (
          <button
            type="button"
            className={connect.quiet}
            onClick={async () => {
              setError(null);
              try {
                await send(`/api/serve/missio/w/${encodeURIComponent(token)}`, { cantMakeIt: true });
                setCant(true);
              } catch {
                setError("That didn’t send. Try again.");
              }
            }}
          >
            I can’t make it this week
          </button>
        )
      ) : null}
      {error ? <p className={connect.banner} role="alert">{error}</p> : null}
    </Shell>
  );
}

/** Board M12c: the leader's two taps, from a link with no login. */
export function LeaderSteps({ token, view: initial, send = post }: { token: string; view: PlacementView; send?: typeof post }) {
  const [view, setView] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = view.person.name.split(" ")[0] || "them";
  const chat = whatsAppHref(view.person.phone);
  const call = telHref(view.person.phone);

  async function step(next: "said_hi" | "first_visit" | "joined") {
    setPending(true);
    setError(null);
    try {
      const body = (await send(`/api/serve/missio/l/${encodeURIComponent(token)}`, { step: next })) as { placement: PlacementView };
      setView(body.placement);
    } catch {
      setError("That didn’t save. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Shell state="leader">
      <h1>
        {view.person.name || "Someone"} is joining {houseTitle(view.house)}
      </h1>
      <div className={styles.card}>
        <PlacementSteps view={view} />
      </div>
      {view.cantMakeItAt && !view.joinedAt ? (
        <p className={connect.lede} role="status">
          {first} said on {shortDate(view.cantMakeItAt)} they can’t make it this week.
        </p>
      ) : null}
      {view.next === "said_hi" ? (
        <>
          <p className={connect.lede}>
            Please say hi by <b>{shortDate(view.leaderDeadline)}</b>. Once you have, {first} gets the address.
          </p>
          {chat ? (
            <a className={styles.waButton} href={`${chat}?text=${encodeURIComponent(`Hi ${first}! It’s great that you’re joining ${houseTitle(view.house)}.`)}`} target="_blank" rel="noopener noreferrer">
              Message {first} on WhatsApp
            </a>
          ) : null}
          {call ? (
            <p className={connect.lede}>
              Or call: <a href={call}>{view.person.phone}</a>
            </p>
          ) : null}
          <button type="submit" disabled={pending} onClick={() => void step("said_hi")}>
            I’ve said hi
          </button>
        </>
      ) : null}
      {view.next === "first_visit" ? (
        <>
          <p className={connect.lede}>Tap when {first} has come for the first time.</p>
          <button type="submit" disabled={pending} onClick={() => void step("first_visit")}>
            {first} came
          </button>
        </>
      ) : null}
      {view.next === "joined" ? (
        <>
          <p className={connect.lede}>Once {first} has been a second time and is part of the house, tap below. They’ll be added to your house.</p>
          <button type="submit" disabled={pending} onClick={() => void step("joined")}>
            {first} is part of the house now
          </button>
        </>
      ) : null}
      {view.joinedAt ? <p className={connect.lede}>{first} is part of {houseTitle(view.house)}. Thank you!</p> : null}
      {view.cancelledAt ? <p className={connect.lede}>This placement was closed by a pastor.</p> : null}
      {error ? <p className={connect.banner} role="alert">{error}</p> : null}
    </Shell>
  );
}
