import { beforeEach, describe, expect, it, vi } from "vitest";
import { FLIP_DURATION_S, FLIP_FADE_S, FLIP_GAIN, FLIP_OFFSET_S, createFlipSound } from "../flip-sound";

// A fake Web Audio graph: enough of AudioContext, AudioBufferSourceNode and
// GainNode to see what the engine starts, when, and with what envelope.

const CLIP = { duration: 1.1, length: 24255 } as unknown as AudioBuffer;

type FakeParam = { value: number; events: [string, number, number][] };
function param(value: number) {
  const p: FakeParam & Record<string, unknown> = {
    value,
    events: [],
    setValueAtTime: vi.fn((v: number, t: number) => p.events.push(["set", v, t])),
    linearRampToValueAtTime: vi.fn((v: number, t: number) => p.events.push(["ramp", v, t])),
    cancelScheduledValues: vi.fn(),
  };
  return p;
}

function makeContext(state: AudioContextState = "suspended") {
  const sources: Record<string, unknown>[] = [];
  const gains: { gain: FakeParam }[] = [];
  const c = {
    state,
    currentTime: 10,
    destination: {},
    resume: vi.fn(() => {
      c.state = "running";
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
    decodeAudioData: vi.fn(() => Promise.resolve(CLIP)),
    createBuffer: vi.fn(() => ({ silent: true })),
    createBufferSource: vi.fn(() => {
      const s: Record<string, unknown> = {
        buffer: null,
        playbackRate: param(1),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      sources.push(s);
      return s;
    }),
    createGain: vi.fn(() => {
      const g = { gain: param(1), connect: vi.fn(), disconnect: vi.fn() };
      gains.push(g);
      return g;
    }),
  };
  /** Sources playing the page-flip clip (not the silent one-frame unlock source). */
  const flips = () => sources.filter((s) => s.buffer === CLIP);
  return { c, sources, gains, flips };
}

type Fake = ReturnType<typeof makeContext>;

let fake: Fake;
let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>>>;

function engine(state: AudioContextState = "suspended") {
  fake = makeContext(state);
  fetchMock = vi.fn((url: string) => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
  return createFlipSound({
    createContext: () => fake.c as unknown as AudioContext,
    createFallback: () => null,
    fetch: fetchMock,
    random: () => 0.5,
  });
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** An engine that has loaded, been unlocked by a gesture, and is running. */
async function ready() {
  const e = engine();
  e.init();
  await settle();
  e.unlock();
  await settle();
  expect(e.isReady).toBe(true);
  expect(fake.c.state).toBe("running");
  return e;
}

describe("store reader flip sound", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads and decodes the clip on init, before any gesture", async () => {
    const e = engine();
    e.init();
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("/store/sounds/page-flip.wav");
    expect(fake.c.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(e.isReady).toBe(true);
  });

  it("decodes the clip once, however many unlocks and plays", async () => {
    const e = await ready();
    for (let i = 0; i < 4; i++) {
      e.unlock();
      e.play();
    }
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.c.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("starts a new source on every turn", async () => {
    const e = await ready();
    for (let i = 0; i < 5; i++) e.play();
    const flips = fake.flips();
    expect(flips).toHaveLength(5);
    for (const s of flips) expect(s.start).toHaveBeenCalledTimes(1);
  });

  it("starts the source synchronously when the context is running", async () => {
    const e = await ready();
    e.play(); // no await: the source must already have started
    expect(fake.flips()).toHaveLength(1);
    expect(fake.flips()[0].start).toHaveBeenCalledWith(fake.c.currentTime, FLIP_OFFSET_S, FLIP_DURATION_S);
  });

  it("plays a 250–400 ms slice with a 40–80 ms fade-out", async () => {
    const e = await ready();
    e.play();
    const [when, offset, duration] = (fake.flips()[0].start as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(when).toBe(fake.c.currentTime);
    expect(offset).toBeGreaterThan(0.7);
    expect(offset).toBeLessThan(0.768); // just before the paper snap
    expect(duration).toBeGreaterThanOrEqual(0.25);
    expect(duration).toBeLessThanOrEqual(0.4);
    // at the pitch used, the slice still lasts 250–400 ms
    const rate = (fake.flips()[0].playbackRate as FakeParam).value;
    expect(duration / rate).toBeGreaterThanOrEqual(0.25);
    expect(duration / rate).toBeLessThanOrEqual(0.4);

    expect(FLIP_FADE_S).toBeGreaterThanOrEqual(0.04);
    expect(FLIP_FADE_S).toBeLessThanOrEqual(0.08);
    const g = fake.gains[fake.gains.length - 1].gain;
    const hold = g.events.find((ev) => ev[0] === "set" && ev[2] > when)!;
    const ramp = g.events.find((ev) => ev[0] === "ramp")!;
    expect(hold[1]).toBe(FLIP_GAIN);
    expect(ramp[1]).toBe(0);
    const fade = ramp[2] - hold[2];
    expect(fade).toBeCloseTo(FLIP_FADE_S, 6);
    expect(ramp[2] - when).toBeCloseTo(duration / rate, 6);
  });

  it("starts nothing while turned off (muted, or before the first tap)", async () => {
    const e = await ready();
    e.enabled = false;
    e.play();
    e.play();
    expect(fake.flips()).toHaveLength(0);
    e.enabled = true;
    e.play();
    expect(fake.flips()).toHaveLength(1);
  });

  it("resumes a suspended context, then plays", async () => {
    const e = await ready();
    fake.c.state = "suspended"; // iOS suspended it after the first gesture
    fake.c.resume.mockClear();
    e.play();
    expect(fake.c.resume).toHaveBeenCalledTimes(1);
    await settle();
    expect(fake.flips()).toHaveLength(1);
    expect(fake.flips()[0].start).toHaveBeenCalledTimes(1);
  });

  it("resumes a suspended context on a later gesture", async () => {
    const e = await ready();
    fake.c.state = "suspended";
    fake.c.resume.mockClear();
    e.unlock();
    expect(fake.c.resume).toHaveBeenCalledTimes(1);
  });

  it("doesn't call resume when the context is already running", async () => {
    const e = await ready();
    fake.c.resume.mockClear();
    e.play();
    expect(fake.c.resume).not.toHaveBeenCalled();
  });

  it("primes the context with a silent source inside the first gesture", async () => {
    const e = engine();
    e.init();
    await settle();
    e.unlock();
    const silent = fake.sources.filter((s) => s.buffer !== CLIP);
    expect(silent).toHaveLength(1);
    expect(silent[0].start).toHaveBeenCalled();
    e.unlock();
    expect(fake.sources.filter((s) => s.buffer !== CLIP)).toHaveLength(1);
  });

  it("cuts the previous voice when a new turn starts, so a flurry never queues", async () => {
    const e = await ready();
    for (let i = 0; i < 6; i++) e.play();
    const flips = fake.flips();
    expect(flips).toHaveLength(6);
    expect(e.liveVoices).toBe(1);
    for (const s of flips.slice(0, -1)) expect(s.stop).toHaveBeenCalledTimes(1);
    expect(flips[flips.length - 1].stop).not.toHaveBeenCalled();
  });

  it("is silent (and doesn't throw) before the clip is decoded or without audio", async () => {
    const e = engine();
    e.play(); // nothing loaded yet
    expect(fake.flips()).toHaveLength(0);

    const none = createFlipSound({
      createContext: () => null,
      createFallback: () => null,
      fetch: () => Promise.reject(new Error("offline")),
    });
    expect(() => {
      none.init();
      none.unlock();
      none.play();
      none.dispose();
    }).not.toThrow();
  });

  it("stops voices and closes the context on dispose", async () => {
    const e = await ready();
    e.play();
    e.dispose();
    expect(fake.flips()[0].stop).toHaveBeenCalled();
    expect(fake.c.close).toHaveBeenCalled();
    e.play();
    expect(fake.flips()).toHaveLength(1);
  });
});
