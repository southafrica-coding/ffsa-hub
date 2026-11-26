// ============================================================
// Store flipbook — the page-flip sound (plain TS, no React)
// ============================================================
// useReaderSound (src/app/(public)/store/_components/reader-sound.ts) owns
// mute, music and the first-gesture unlock; this module only plays the
// flip sample. The tests in __tests__/flip-sound.test.ts pin it down.
//
// How it works:
//  - init() (on mount) fetches the wav, makes the AudioContext (it starts
//    suspended, which is fine) and decodes the clip once, so the buffer is
//    ready before the first turn.
//  - unlock() is called on every tap, click and key press. It resumes the
//    context if the browser suspended it (iOS does, often after the first
//    gesture) and, the first time, starts a silent one-frame source inside
//    the gesture, which is what iOS wants before it lets the context run.
//  - play() starts a fresh source on every turn, at once, through its own
//    gain node: a short slice of the clip with a quick fade-out. A new turn
//    fades out the previous voice, so a flurry never builds a backlog.
//
// Where there's no Web Audio at all, an <audio> element plays the same
// slice. Any failure is silent: the book works without sound.

export const FLIP_URL = "/store/sounds/page-flip.wav";

/** Where the slice starts in page-flip.wav: just before the paper snap (peak at 0.768 s). */
export const FLIP_OFFSET_S = 0.74;
/** How much of the clip each turn plays (the wav itself is 1.1 s). */
export const FLIP_DURATION_S = 0.32;
/** The fade-out at the end of the slice. */
export const FLIP_FADE_S = 0.06;
/** Loudness of the flip. */
export const FLIP_GAIN = 0.7;
/** How quickly a voice is faded out when the next turn starts. */
export const FLIP_CUT_S = 0.015;
/** Most flips sounding at once (the previous one is cut when a new one starts). */
export const FLIP_MAX_VOICES = 1;
/** A flip that waited longer than this for the context to resume is dropped (it would sound late). */
export const FLIP_STALE_MS = 150;
/** Small random pitch change per turn so repeats don't sound identical. */
const RATE_MIN = 0.96;
const RATE_SPREAD = 0.08;

type Voice = { src: AudioBufferSourceNode; gain: GainNode };

export type FlipSoundOptions = {
  url?: string;
  /** Makes the AudioContext; returns null where there's no Web Audio. */
  createContext?: () => AudioContext | null;
  /** Makes the <audio> element used only when there's no Web Audio. */
  createFallback?: (url: string) => HTMLAudioElement | null;
  fetch?: (url: string) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  now?: () => number;
  random?: () => number;
};

function defaultContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return AC ? new AC() : null;
}

function defaultFallback(url: string): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  const a = new Audio(url);
  a.preload = "auto";
  return a;
}

export function createFlipSound(options: FlipSoundOptions = {}) {
  const url = options.url ?? FLIP_URL;
  const makeContext = options.createContext ?? defaultContext;
  const makeFallback = options.createFallback ?? defaultFallback;
  const doFetch = options.fetch ?? ((u: string) => fetch(u));
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const random = options.random ?? Math.random;

  let ctx: AudioContext | null = null;
  let noWebAudio = false;
  let bytes: Promise<ArrayBuffer> | null = null;
  let decoding: Promise<AudioBuffer | null> | null = null;
  let buffer: AudioBuffer | null = null;
  let primed = false;
  let disposed = false;
  let voices: Voice[] = [];
  let fallback: HTMLAudioElement | null = null;
  let fallbackStop: ReturnType<typeof setTimeout> | null = null;

  /** Fetch the wav once. Needs no gesture. */
  function prefetch() {
    if (!bytes) {
      bytes = doFetch(url).then((r) => r.arrayBuffer());
      bytes.catch(() => {});
    }
    return bytes;
  }

  /** Make the context if we haven't yet (null where there's no Web Audio). */
  function ensureContext(): AudioContext | null {
    if (ctx || noWebAudio || disposed) return ctx;
    try {
      ctx = makeContext();
    } catch {
      ctx = null; // some browsers refuse outside a gesture; the next unlock() tries again
      return null;
    }
    if (!ctx) noWebAudio = true;
    return ctx;
  }

  /** Decode the clip once, into the shared context. */
  function decode() {
    const c = ctx;
    if (!c || decoding) return;
    decoding = prefetch()
      .then(
        (b) =>
          new Promise<AudioBuffer>((resolve, reject) => {
            // The promise form; older Safari only calls back, so pass those too.
            const p = c.decodeAudioData(b, resolve, reject) as Promise<AudioBuffer> | undefined;
            if (p && typeof p.then === "function") p.then(resolve, reject);
          })
      )
      .then((b) => {
        if (!disposed) buffer = b;
        return b;
      })
      .catch(() => {
        decoding = null; // let a later unlock() try again
        return null;
      });
  }

  function resume(c: AudioContext) {
    if (c.state !== "running" && c.state !== "closed") {
      return c.resume().catch(() => {});
    }
    return Promise.resolve();
  }

  /** Start loading as soon as the reader opens. Safe without a gesture. */
  function init() {
    prefetch();
    if (ensureContext()) decode();
  }

  /** Call inside every tap / click / key press: wakes the context, loads the clip if needed. */
  function unlock() {
    if (disposed) return;
    prefetch();
    const c = ensureContext();
    if (!c) {
      if (noWebAudio && !fallback) fallback = makeFallback(url);
      return;
    }
    decode();
    resume(c);
    if (!primed) {
      // iOS lets a context run once a source has started inside a gesture.
      try {
        const s = c.createBufferSource();
        s.buffer = c.createBuffer(1, 1, 22050);
        s.connect(c.destination);
        s.start(0);
        primed = true;
      } catch {
        /* nothing to prime with */
      }
    }
  }

  function cutVoices(c: AudioContext, keep: number) {
    const t = c.currentTime;
    while (voices.length > keep) {
      const v = voices.shift()!;
      try {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setValueAtTime(v.gain.gain.value, t);
        v.gain.gain.linearRampToValueAtTime(0, t + FLIP_CUT_S);
        v.src.stop(t + FLIP_CUT_S);
      } catch {
        /* already stopped */
      }
    }
  }

  function start(c: AudioContext, b: AudioBuffer) {
    cutVoices(c, FLIP_MAX_VOICES - 1);
    const t = c.currentTime;
    const rate = RATE_MIN + random() * RATE_SPREAD;
    const length = FLIP_DURATION_S / rate; // how long the slice lasts at this rate
    const src = c.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const gain = c.createGain();
    gain.gain.setValueAtTime(FLIP_GAIN, t);
    gain.gain.setValueAtTime(FLIP_GAIN, t + length - FLIP_FADE_S);
    gain.gain.linearRampToValueAtTime(0, t + length);
    src.connect(gain);
    gain.connect(c.destination);
    const voice = { src, gain };
    voices.push(voice);
    src.onended = () => {
      voices = voices.filter((v) => v !== voice);
      try {
        gain.disconnect();
      } catch {
        /* gone already */
      }
    };
    src.start(t, FLIP_OFFSET_S, FLIP_DURATION_S);
  }

  function playFallback() {
    const f = fallback ?? (fallback = makeFallback(url));
    if (!f) return;
    try {
      if (fallbackStop) clearTimeout(fallbackStop);
      f.currentTime = FLIP_OFFSET_S;
      f.play().catch(() => {});
      fallbackStop = setTimeout(() => f.pause(), FLIP_DURATION_S * 1000);
    } catch {
      /* no sound */
    }
  }

  /** One page turn. Call at the moment the flip animation starts. */
  function play() {
    if (disposed || !engine.enabled) return;
    const c = ensureContext();
    if (!c) {
      if (noWebAudio) playFallback();
      return;
    }
    const b = buffer;
    if (!b) {
      decode(); // not ready yet: this turn is silent, the next one won't be
      return;
    }
    try {
      if (c.state === "running") {
        start(c, b);
        return;
      }
      const asked = now();
      resume(c).then(() => {
        if (disposed || c.state !== "running" || now() - asked > FLIP_STALE_MS) return;
        try {
          start(c, b);
        } catch {
          /* no sound */
        }
      });
    } catch {
      /* no sound */
    }
  }

  function dispose() {
    disposed = true;
    if (ctx) cutVoices(ctx, 0);
    voices = [];
    if (fallbackStop) clearTimeout(fallbackStop);
    fallback?.pause();
    fallback = null;
    ctx?.close().catch(() => {});
    ctx = null;
    buffer = null;
  }

  const engine = {
    /** Turned off while muted or before the reader has touched the page. */
    enabled: true,
    init,
    unlock,
    play,
    dispose,
    get isReady() {
      return !!buffer;
    },
    /** Sources currently sounding (for tests). */
    get liveVoices() {
      return voices.length;
    },
  };
  return engine;
}

export type FlipSound = ReturnType<typeof createFlipSound>;
