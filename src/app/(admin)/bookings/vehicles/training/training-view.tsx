"use client";

// The Training page's player: one moment of a booking at a time, with what the person
// booking sees on one side and the coordinator's part on the other. The messages are the
// real ones (scenario.json); the practice form saves nothing.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { DueBackNote } from "@/components/vehicles/due-back-note";
import { dueBackFrom, RETURN_BY } from "@/lib/vehicles/return-day";
import { cn } from "@/lib/utils/cn";
import { isCoordinator, type TrainingEvent, type TrainingStep } from "@/lib/vehicles/training/script";

type View = "both" | "booker" | "coordinator";
const VIEWS: { id: View; label: string }[] = [
  { id: "both", label: "Both" },
  { id: "booker", label: "Person booking" },
  { id: "coordinator", label: "Coordinator" },
];

// ── Dates ────────────────────────────────────────────────────────────
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(iso.slice(0, 10) + "T00:00:00Z")
  );

// ── Slack mrkdwn, enough for our own messages ────────────────────────
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function mrkdwn(text: string): string {
  return esc(text)
    .replace(/&lt;(https?:\/\/[^|&]+)\|(.+?)&gt;/g, '<span class="underline">$2</span>')
    .replace(/&lt;(https?:\/\/[^&]+)&gt;/g, '<span class="underline">$1</span>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<b>$2</b>")
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])~([^~\n]+)~/g, "$1<s>$2</s>")
    .replace(/\n/g, "<br>");
}

type Block = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function SlackBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((b, i) => {
        if (b.type === "section" && b.text?.text)
          return <div key={i} className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: mrkdwn(b.text.text) }} />;
        if (b.type === "context")
          return (
            <div
              key={i}
              className="text-xs text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: mrkdwn((b.elements ?? []).map((e: Block) => e.text ?? "").join(" ")) }}
            />
          );
        if (b.type === "actions")
          return (
            <div key={i} className="flex flex-wrap gap-2">
              {(b.elements ?? []).map((e: Block, j: number) =>
                e.type === "button" ? (
                  <span
                    key={j}
                    className={cn(
                      "border px-3 py-1.5 text-sm font-bold",
                      e.style === "primary" ? "border-ink bg-ink text-white" : e.style === "danger" ? "border-destructive text-destructive" : "border-ink"
                    )}
                  >
                    {e.text?.text}
                  </span>
                ) : (
                  <span key={j} className="border border-rule px-3 py-1.5 text-sm text-muted-foreground">
                    {e.placeholder?.text ?? "Choose…"} ▾
                  </span>
                )
              )}
            </div>
          );
        if (b.type === "input")
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <b>{b.label?.text}</b>
              <span className="border border-rule px-3 py-1 text-muted-foreground">Choose a day</span>
            </div>
          );
        return null;
      })}
    </div>
  );
}

const KIND: Record<TrainingEvent["kind"], string> = {
  slack: "Slack",
  "slack-update": "Slack · message updated",
  modal: "Slack pop-up",
  email: "Email",
};

// Links in the emails point at the made-up booking; they're shown, not followed.
const emailDoc = (html: string) => html.replace("</head>", "<style>a{pointer-events:none}</style></head>");

function EventCard({ e }: { e: TrainingEvent }) {
  const size = (e.blocks ?? []).reduce((n, b) => n + String((b as Block).text?.text ?? "").length, 0);
  const body =
    e.kind === "email" ? (
      <div className="px-3.5 pb-3 pt-2.5">
        <div className="font-semibold">{e.subject}</div>
        <details className="mt-1">
          <summary className="cursor-pointer py-1 text-sm text-muted-foreground">Open the email</summary>
          <iframe
            title={e.subject}
            sandbox="allow-same-origin"
            srcDoc={emailDoc(e.html ?? "")}
            className="mt-2 h-[520px] w-full border border-rule bg-white"
          />
        </details>
      </div>
    ) : (
      <div className="px-3.5 py-3">
        {size > 1200 ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold">{e.text}</summary>
            <div className="pt-3">
              <SlackBlocks blocks={e.blocks ?? []} />
            </div>
          </details>
        ) : e.blocks?.length ? (
          <SlackBlocks blocks={e.blocks} />
        ) : (
          <div className="text-sm" dangerouslySetInnerHTML={{ __html: mrkdwn(e.text) }} />
        )}
      </div>
    );
  return (
    <article className="min-w-0 border border-rule bg-white [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-bone px-3 py-2">
        <span
          className={cn(
            "border border-ink px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]",
            e.kind === "email" ? "bg-white" : "bg-ink text-white",
            e.kind === "slack-update" && "border-dashed"
          )}
        >
          {KIND[e.kind]}
        </span>
        <span className="text-xs text-muted-foreground">to {e.to}</span>
      </div>
      {body}
    </article>
  );
}

function Column({ title, note, events, empty }: { title: string; note: React.ReactNode; events: TrainingEvent[]; empty: string }) {
  return (
    <section className="min-w-0">
      <div className="bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white">{title}</div>
      <div className="border-x border-b border-rule px-4 py-3 text-[15px] leading-relaxed">{note}</div>
      <div className="mt-3 flex flex-col gap-3">
        {events.length ? events.map((e, i) => <EventCard key={i} e={e} />) : <p className="text-sm text-muted-foreground">{empty}</p>}
      </div>
    </section>
  );
}

// ── The practice form ────────────────────────────────────────────────
type Driver = { name: string; hub: boolean; email: string };
const PRACTICE_VEHICLES = ["Nissan Almera (DEMO 1 GP)", "Honda CR-V (DEMO 2 GP)", "VW Kombi (DEMO 3 GP)"];

function PracticeForm({ onSend }: { onSend: () => void }) {
  const [name, setName] = useState("Visiting team: Kruger outreach");
  const [from, setFrom] = useState("2026-11-30");
  const [last, setLast] = useState("2026-12-03");
  const [picked, setPicked] = useState<string[]>(PRACTICE_VEHICLES.slice(0, 2));
  const [drivers, setDrivers] = useState<Driver[]>([
    { name: "Thandi Mokoena", hub: true, email: "" },
    { name: "Sam Taylor", hub: false, email: "sam@example.org" },
    { name: "Lee Chen", hub: false, email: "" },
  ]);
  const setDriver = (i: number, d: Partial<Driver>) => setDrivers((all) => all.map((x, j) => (j === i ? { ...x, ...d } : x)));
  const backOn = last ? dayLabel(dueBackFrom(last)) : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="t-name">What&apos;s it for? *</Label>
        <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Collection date *</Label>
          <DateInput value={from} onChange={setFrom} />
        </div>
        <div className="space-y-2">
          <Label>Last day you need it *</Label>
          <DateInput value={last} onChange={setLast} />
        </div>
      </div>
      <DueBackNote lastDay={last} />
      <div className="space-y-2">
        <Label>Vehicle(s) requested</Label>
        <div className="flex flex-col gap-1">
          {PRACTICE_VEHICLES.map((v) => (
            <label key={v} className="flex min-h-11 items-center gap-3 border-b border-rule text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={picked.includes(v)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, v] : p.filter((x) => x !== v)))}
              />
              {v}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Drivers</Label>
        <p className="text-xs text-muted-foreground">
          Hub users are picked from the Hub, and their licence comes from their profile. For anyone else, type their name and
          email, and add their licence and passport photos. Their instructions go to that email.
        </p>
        {drivers.map((d, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 border-b border-rule pb-3 sm:grid-cols-[1fr_1fr]">
            <Input aria-label={`Driver ${i + 1} name`} value={d.name} onChange={(e) => setDriver(i, { name: e.target.value })} />
            {d.hub ? (
              <span className="flex min-h-10 items-center text-sm text-muted-foreground">On the Hub: Slack and email</span>
            ) : (
              <Input
                aria-label={`Driver ${i + 1} email`}
                type="email"
                placeholder="Email (optional)"
                value={d.email}
                onChange={(e) => setDriver(i, { email: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button onClick={onSend} className="min-h-11">
          Send request (practice)
        </Button>
        <span className="text-xs text-muted-foreground">
          {backOn ? `Due back ${backOn}, before ${RETURN_BY}. ` : ""}Nothing is saved or sent.
        </span>
      </div>
    </div>
  );
}

// ── The player ───────────────────────────────────────────────────────
type Cast = { name: string; part: string };
type Slide = { key: string; day: string; time: string; title: string; short: string; booking?: "A" | "B" };

export function TrainingView({ steps, cast }: { steps: TrainingStep[]; cast: Cast[] }) {
  const [view, setView] = useState<View>("both");
  const [idx, setIdx] = useState(0);

  const slides: Slide[] = useMemo(
    () => [
      { key: "intro", day: "Start", time: "", title: "The rules and the people", short: "The rules" },
      { key: "form", day: "Sun 29 Nov", time: "09:30", title: "Thandi fills in the booking form", short: "The booking form", booking: "A" },
      ...steps.map((s, i) => ({ key: `s${i}`, day: dayLabel(s.at), time: s.at.slice(11), title: s.title, short: s.short, booking: s.booking })),
    ],
    [steps]
  );
  const last = slides.length - 1;
  const go = useCallback((n: number) => {
    setIdx(Math.max(0, Math.min(last, n)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [last]);

  // ← and → step through, for presenting (not while typing in the practice form).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") go(idx + 1);
      if (e.key === "ArrowLeft") go(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, go]);

  const slide = slides[idx];
  const step = idx >= 2 ? steps[idx - 2] : null;
  const showBooker = view !== "coordinator";
  const showCoord = view !== "booker";

  return (
    <div>
      {/* Practice bar + whose side to show */}
      <div className="flex flex-col gap-3 border-b border-rule bg-bone px-5 py-3 md:flex-row md:items-center md:justify-between md:px-8">
        <p className="text-sm">
          <b>Practice only.</b> Made-up people and vehicles. Nothing is saved or sent. The messages are the Hub&apos;s real ones.
        </p>
        <div className="flex shrink-0" role="group" aria-label="Show">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "-ml-px min-h-11 border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] first:ml-0",
                view === v.id ? "bg-ink text-white" : "bg-white"
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[230px_minmax(0,1fr)]">
        {/* Step list */}
        <nav aria-label="Steps" className="hidden border-r border-rule md:block">
          <ol className="sticky top-0">
            {slides.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === idx ? "step" : undefined}
                  className={cn(
                    "flex min-h-11 w-full items-baseline gap-2.5 border-b border-rule px-4 py-2.5 text-left text-[11px] leading-snug",
                    i === idx ? "bg-ink text-white" : "hover:bg-bone"
                  )}
                >
                  <span className={cn("w-12 shrink-0 font-mono text-[10px] tracking-[0.08em]", i === idx ? "text-white/70" : "text-muted-foreground")}>
                    {i === 0 ? "—" : s.day.replace(/^\w+ /, "")}
                  </span>
                  <span className="min-w-0">{s.short}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 px-5 py-6 md:px-8 md:py-7">
          {/* Phone: jump to a step */}
          <select
            aria-label="Go to step"
            className="mb-4 min-h-11 w-full border border-ink bg-white px-2 text-sm md:hidden"
            value={idx}
            onChange={(e) => go(Number(e.target.value))}
          >
            {slides.map((s, i) => (
              <option key={s.key} value={i}>
                {i + 1}. {s.short}
              </option>
            ))}
          </select>

          <header className="mb-5 flex flex-wrap items-end gap-x-5 gap-y-1">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{slide.day}</span>
              {slide.time && <span className="font-display text-4xl font-black leading-none tabular-nums">{slide.time}</span>}
            </div>
            <div className="w-full">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Step {idx + 1} of {slides.length}
                {slide.booking ? ` · Booking ${slide.booking}` : ""}
              </div>
              <h2 className="font-display text-2xl font-black uppercase leading-tight md:text-3xl">{slide.title}</h2>
            </div>
          </header>

          {idx === 0 && <Intro cast={cast} />}

          {idx === 1 && (
            <div className={cn("grid grid-cols-1 gap-6", showBooker && showCoord && "lg:grid-cols-2")}>
              {showBooker && (
                <section className="min-w-0">
                  <div className="bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white">The person booking</div>
                  <div className="border-x border-b border-rule px-4 py-4">
                    <p className="mb-4 text-[15px] leading-relaxed">
                      Rent a Vehicle → New request. Thandi needs two cars for a visiting team from Monday to Thursday. She picks
                      Thursday as the last day; the form shows it&apos;s due back on Friday morning. Try changing the dates.
                    </p>
                    <PracticeForm onSend={() => go(2)} />
                  </div>
                </section>
              )}
              {showCoord && (
                <Column
                  title="Behind the scenes · Coordinator"
                  note="Nothing yet. The request reaches you the moment it's sent."
                  events={[]}
                  empty=""
                />
              )}
            </div>
          )}

          {step && (
            <div className={cn("grid grid-cols-1 gap-6", showBooker && showCoord && "lg:grid-cols-2")}>
              {showBooker && (
                <Column
                  title="The person booking and the drivers"
                  note={step.booker}
                  events={step.events.filter((e) => !isCoordinator(e))}
                  empty="No messages to them at this moment."
                />
              )}
              {showCoord && (
                <Column
                  title="Behind the scenes · Coordinator"
                  note={step.coordinator}
                  events={step.events.filter(isCoordinator)}
                  empty="No message to the coordinator at this moment."
                />
              )}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-rule pt-4">
            <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => go(idx - 1)} disabled={idx === 0}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <span className="hidden text-xs text-muted-foreground sm:inline">← and → keys work too</span>
            {idx < last ? (
              <Button className="min-h-11 gap-1.5" onClick={() => go(idx + 1)}>
                Next<span className="hidden sm:inline">: {slides[idx + 1].short}</span> <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button className="min-h-11" onClick={() => go(0)}>
                Start again
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Intro({ cast }: { cast: Cast[] }) {
  const rules = [
    ["Due back", `The day after the last day it's needed, before ${RETURN_BY}: washed, full tank, return inspection done. The form asks for the last day; the Hub adds the next morning and keeps it free.`],
    ["Pick-up day · 06:30", "The person who booked gets their own instructions. Every driver gets the driver instructions. Pick-ups happen between 07:00 and 17:00."],
    ["Day before · 07:00", "A reminder, with Return early (a button for Hub users, the coordinator's number for others)."],
    ["Due-back day · 07:00", "Return instructions to everyone. The coordinator gets a Slack message with Returned."],
    ["After Returned", "A post-rental inspection message links to Fleet. Saving every vehicle's inspection completes the booking."],
    ["International teams", "After an International Team booking, the vehicles are held for 3 working days (not weekends or public holidays) after the due-back day for the inspection and a full valet wash. The coordinator gets a reminder to book the valet, and can release the hold, with a note saying why."],
    ["Who gets what", "On the Hub: Slack and email. Not on the Hub: email. No email on the booking: the person who booked is asked to pass it on."],
  ];
  return (
    <div className="space-y-6">
      <p className="max-w-[70ch] text-[15px] leading-relaxed">
        Two made-up bookings, followed day by day. <b>Booking A</b>: Thandi books a Nissan Almera and a Honda CR-V for a
        visiting team (an International Team booking), from Mon 30 Nov until Thu 3 Dec. <b>Booking B</b>: Jonah books the VW Kombi and asks to bring it back
        early. Use <b>Show</b> above to follow only the person booking, or only the coordinator.
      </p>
      <div>
        <div className="bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white">The rules</div>
        <dl className="grid grid-cols-1 border-l border-rule sm:grid-cols-2 xl:grid-cols-3">
          {rules.map(([k, v]) => (
            <div key={k} className="border-b border-r border-rule px-4 py-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k}</dt>
              <dd className="mt-1 text-sm leading-relaxed">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <div className="bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white">The people (made up)</div>
        <ul className="grid grid-cols-1 border-l border-rule sm:grid-cols-2 xl:grid-cols-3">
          {cast.map((c) => (
            <li key={c.name} className="border-b border-r border-rule px-4 py-3">
              <b className="block">{c.name}</b>
              <span className="text-sm text-muted-foreground">{c.part}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
