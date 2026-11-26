"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The flipbook's sound: a short page-flip on each turn, and the product's
// background music if Media uploaded one. One speaker toggle mutes or
// unmutes both, and the choice is remembered on this device.
//
// Browsers (iOS above all) only let a page make sound after the reader has
// touched it, so nothing plays until the first tap, click or key press,
// whatever the saved choice. Every play() that starts sound is called from
// inside that gesture's own handler, never from an effect afterwards.

const KEY = "ffsa-store-sound";
const FLIP_URL = "/store/sounds/page-flip.wav";
const MUSIC_VOLUME = 0.35;

type AnyAudioContext = AudioContext;

export function useReaderSound({ musicUrl, onMusicExpired }: { musicUrl?: string | null; onMusicExpired?: () => void }) {
  const [wantOn, setWantOn] = useState(true); // the saved choice (default on)
  const [unlocked, setUnlocked] = useState(false); // the reader has touched the page
  const on = wantOn && unlocked;
  const onRef = useRef(on);
  onRef.current = on;
  const wantRef = useRef(wantOn);
  wantRef.current = wantOn;

  const ctx = useRef<AnyAudioContext | null>(null);
  const buffer = useRef<AudioBuffer | null>(null);
  const fallback = useRef<HTMLAudioElement | null>(null);
  const music = useRef<HTMLAudioElement | null>(null);
  const expired = useRef(onMusicExpired);
  const lastExpired = useRef(0);
  expired.current = onMusicExpired;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === "off") setWantOn(false);
    } catch {
      /* private mode: keep the default */
    }
  }, []);

  /** Make (or wake) the audio context and load the flip sample. Call inside a gesture. */
  const wake = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!ctx.current) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        try {
          ctx.current = new AC();
          fetch(FLIP_URL)
            .then((r) => r.arrayBuffer())
            .then((b) => new Promise<AudioBuffer>((res, rej) => ctx.current!.decodeAudioData(b, res, rej)))
            .then((b) => (buffer.current = b))
            .catch(() => {});
        } catch {
          ctx.current = null;
        }
      }
    }
    // Plays the flip until the sample is decoded (and where there's no Web Audio).
    if (!fallback.current) {
      fallback.current = new Audio(FLIP_URL);
      fallback.current.preload = "auto";
      fallback.current.load();
    }
    if (ctx.current?.state === "suspended") ctx.current.resume().catch(() => {});
  }, []);

  const playMusic = useCallback(() => {
    const m = music.current;
    if (m && m.paused) m.play().catch(() => {});
  }, []);

  // The first gesture anywhere unlocks sound (the speaker button handles its own).
  useEffect(() => {
    if (unlocked) return;
    const first = (e: Event) => {
      if (e.target instanceof Element && e.target.closest("[data-sound-toggle]")) return;
      setUnlocked(true);
      onRef.current = wantRef.current; // this same gesture may turn the page
      wake();
      if (wantRef.current) playMusic();
    };
    const opts = { capture: true } as const;
    window.addEventListener("pointerdown", first, opts);
    window.addEventListener("touchend", first, opts);
    window.addEventListener("keydown", first, opts);
    return () => {
      window.removeEventListener("pointerdown", first, opts);
      window.removeEventListener("touchend", first, opts);
      window.removeEventListener("keydown", first, opts);
    };
  }, [unlocked, wake, playMusic]);

  // The music element follows the signed link; a new link (after one expired) carries on where it was.
  useEffect(() => {
    if (!musicUrl) {
      music.current?.pause();
      music.current = null;
      return;
    }
    const was = music.current;
    const at = was ? was.currentTime : 0;
    was?.pause();
    const m = new Audio();
    m.loop = true;
    m.preload = "none";
    m.volume = MUSIC_VOLUME;
    m.src = musicUrl;
    if (at) m.currentTime = at;
    m.onerror = () => {
      // Probably an expired link: ask for a new one, but at most once a minute (a broken file mustn't loop).
      if (Date.now() - lastExpired.current < 60_000) return;
      lastExpired.current = Date.now();
      expired.current?.();
    };
    music.current = m;
    if (onRef.current) m.play().catch(() => {});
    return () => {
      m.onerror = null;
    };
  }, [musicUrl]);

  // Muted → pause the music; also pause while the tab is hidden.
  useEffect(() => {
    if (!on) music.current?.pause();
    const vis = () => {
      if (document.hidden) music.current?.pause();
      else if (onRef.current) playMusic();
    };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [on, playMusic]);

  useEffect(() => () => {
    music.current?.pause();
    ctx.current?.close().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    // What the button showed is what it changes from.
    const next = !(wantRef.current && unlocked);
    setUnlocked(true);
    setWantOn(next);
    onRef.current = next;
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      /* not remembered, still works */
    }
    if (next) {
      wake();
      playMusic();
    } else {
      music.current?.pause();
    }
  }, [unlocked, wake, playMusic]);

  /** The page-flip effect. Silent while muted or before the first tap. */
  const flip = useCallback(() => {
    if (!onRef.current) return;
    const c = ctx.current;
    const b = buffer.current;
    if (c && b) {
      const src = c.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = 0.94 + Math.random() * 0.12;
      const g = c.createGain();
      g.gain.value = 0.7;
      src.connect(g).connect(c.destination);
      src.start();
      return;
    }
    const f = fallback.current;
    if (f) {
      f.currentTime = 0;
      f.play().catch(() => {});
    }
  }, []);

  return { on, toggle, flip, hasMusic: !!musicUrl };
}
