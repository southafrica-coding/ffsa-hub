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
      <div className={`${connect.column} ${styles.publicColumn}`}>
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
  const leaders = view.leaders.filter((leader) => leader.name.trim());
  const leaderFirsts = leaders.map((leader) => leader.name.split(" ")[0]);
  const chatLeader = leaders.find((leader) => whatsAppHref(leader.phone));
  const chat = chatLeader ? whatsAppHref(chatLeader.phone) : null;
  const next = nextMeeting(view.house.meetingDay);
  return (
    <Shell state="person">
      <div>
        <p className={styles.kicker}>Hi {first}, welcome to</p>
        <h1 className={styles.publicTitle}>{houseTitle(view.house)}</h1>
      </div>
      <PlacementSteps view={view} />
      <div className={`${styles.card} ${styles.facts}`}>
        {view.house.meetingDay ? (
          <div className={styles.fact}>
            <CalendarIcon />
            <div>
              <b>{dayName(view.house.meetingDay)}s</b>
              {next ? <p className={styles.factSub}>Next: {next}</p> : null}
            </div>
          </div>
        ) : null}
        <div className={styles.fact}>
          <PinIcon />
          {view.house.location ? (
            <div>
              <b>{view.house.location}</b>
              <p className={styles.factSub}>
                <a href={`https://maps.google.com/?q=${encodeURIComponent(view.house.location)}`} target="_blank" rel="noopener noreferrer">
                  Open in Maps
                </a>
              </p>
            </div>
          ) : (
            <div>
              <b>Address to follow</b>
              <p className={styles.factSub}>You’ll get it once your leader has said hi.</p>
            </div>
          )}
        </div>
        {leaders.length > 0 ? (
          <div className={`${styles.fact} ${styles.factRule}`}>
            <span className={styles.stack} aria-hidden="true">
              {leaders.slice(0, 3).map((leader, index) => (
                <span key={`${leader.name}-${index}`} className={`${styles.av} ${TINT[index % TINT.length]}`}>
                  {initials(leader.name)}
                </span>
              ))}
            </span>
            <div className={styles.factGrow}>
              <b>{leaderFirsts.join(" & ")}</b>
              <p className={styles.factSub}>your house church {leaders.length > 1 ? "leaders" : "leader"}</p>
            </div>
            {chat && chatLeader ? (
              <a className={styles.waIcon} href={chat} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${chatLeader.name.split(" ")[0]}`}>
                <ChatIcon />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className={styles.expect}>
        <b>What to expect:</b> a meal together, worship, a short time in the Bible and prayer. Come as you are. Nobody will put you on the spot.
      </p>
      {!view.joinedAt ? (
        cant ? (
          <p className={styles.expect} role="status">
            Thanks for letting us know. Your leader knows, and we’ll see you next week.
          </p>
        ) : (
          <button
            type="button"
            className={styles.textLink}
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
  const name = view.person.name || "Someone";
  const first = view.person.name.split(" ")[0] || "them";
  const chat = whatsAppHref(view.person.phone);
  const call = telHref(view.person.phone);
  const house = houseTitle(view.house);
  const message = chat ? `${chat}?text=${encodeURIComponent(`Hi ${first}! It’s great that you’re joining ${house}.`)}` : null;

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

  const open = Boolean(view.next) && !view.cancelledAt;

  return (
    <Shell state="leader">
      <div className={`${styles.card} ${styles.leaderCard} ${open ? styles.leaderCardOn : ""}`}>
        <div className={styles.fact}>
          <span className={`${styles.av} ${TINT[3]}`} aria-hidden="true">
            {initials(name)}
          </span>
          <div className={styles.factGrow}>
            <h1 className={styles.leaderTitle}>
              {name} is joining {house}
            </h1>
            <p className={styles.factSub}>Placed {shortDate(view.placedAt)}</p>
          </div>
        </div>
        {view.cantMakeItAt && !view.joinedAt ? (
          <p className={styles.note} role="status">
            {first} said on {shortDate(view.cantMakeItAt)} they can’t make it this week.
          </p>
        ) : null}
        {view.next === "said_hi" ? (
          <>
            <p className={styles.note}>
              Please say hi by <b>{shortDate(view.leaderDeadline)}</b>. Once you have, {first} gets the address.
            </p>
            <div className={message ? styles.pair : undefined}>
              {message ? (
                <a className={styles.secondaryButton} href={message} target="_blank" rel="noopener noreferrer">
                  <ChatIcon />
                  Message {first}
                </a>
              ) : null}
              <button type="submit" className={styles.primaryButton} disabled={pending} onClick={() => void step("said_hi")}>
                <CheckIcon />
                I’ve said hi
              </button>
            </div>
            {call ? (
              <p className={styles.factSub}>
                Or call <a href={call}>{view.person.phone}</a>
              </p>
            ) : null}
          </>
        ) : null}
        {view.next === "first_visit" ? (
          <>
            <p className={styles.note}>Tap when {first} has come for the first time.</p>
            <button type="submit" className={styles.primaryButton} disabled={pending} onClick={() => void step("first_visit")}>
              {first} came
            </button>
          </>
        ) : null}
        {view.next === "joined" ? (
          <>
            <p className={styles.note}>Once {first} has been a second time and is part of the house, tap below. They’ll be added to your house.</p>
            <button type="submit" className={styles.primaryButton} disabled={pending} onClick={() => void step("joined")}>
              {first} is part of the house now
            </button>
          </>
        ) : null}
        {view.joinedAt ? <p className={styles.note}>{first} is part of {house}. Thank you!</p> : null}
        {view.cancelledAt ? <p className={styles.note}>This placement was closed by a pastor.</p> : null}
      </div>
      <PlacementSteps view={view} />
      {error ? <p className={connect.banner} role="alert">{error}</p> : null}
    </Shell>
  );
}

const TINT = [styles.a1, styles.a2, styles.a3, styles.a4, styles.a5];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function CalendarIcon() {
  return (
    <span className={styles.factIcon}>
      <Svg>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </Svg>
    </span>
  );
}

function PinIcon() {
  return (
    <span className={styles.factIcon}>
      <Svg>
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </Svg>
    </span>
  );
}

function ChatIcon() {
  return (
    <Svg>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}
