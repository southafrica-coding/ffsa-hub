"use client";

// Voice for the legal helper, using the browser's own speech features:
//   * listening: SpeechRecognition (Chrome, Edge, Safari incl. iPhone).
//     In Chrome the audio is sent to Google to be turned into text, and in
//     Safari to Apple; the Hub never receives or keeps audio.
//   * speaking: speechSynthesis, which runs on the device.
// No new service, key or account. Where a browser can't do it (Firefox
// can't listen), `supported` is false and the screen says so.

import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API isn't in TypeScript's DOM types yet.
type RecognitionResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LISTEN_ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it for this site in the browser settings.",
  "service-not-allowed": "Speech recognition is switched off in this browser.",
  "no-speech": "I didn't hear anything. Tap the microphone and try again.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs an internet connection.",
};

/** Listen once: interim text while speaking, the final text when done. */
export function useListener(lang = "en-ZA") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => setSupported(!!recognitionCtor()), []);
  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(
    (onFinal: (text: string) => void) => {
      const Ctor = recognitionCtor();
      if (!Ctor) return;
      rec.current?.abort();
      const r = new Ctor();
      r.lang = lang;
      r.continuous = false;
      r.interimResults = true;
      let finalText = "";
      r.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += res[0].transcript;
          else live += res[0].transcript;
        }
        setInterim((finalText + " " + live).trim());
      };
      r.onerror = (e) => {
        if (e.error !== "aborted") setError(LISTEN_ERRORS[e.error] ?? "Listening stopped. Try again.");
      };
      r.onend = () => {
        setListening(false);
        setInterim("");
        const text = finalText.trim();
        if (text) onFinal(text);
      };
      setError(null);
      setInterim("");
      setListening(true);
      rec.current = r;
      try {
        r.start();
      } catch {
        setListening(false);
      }
    },
    [lang]
  );

  const stop = useCallback(() => rec.current?.stop(), []);
  const cancel = useCallback(() => {
    rec.current?.abort();
    setListening(false);
    setInterim("");
  }, []);

  return { supported, listening, interim, error, start, stop, cancel };
}

/** Read text aloud on the device, preferring a South African or British English voice. */
export function useSpeaker() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voice = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      voice.current =
        voices.find((v) => v.lang === "en-ZA") ??
        voices.find((v) => v.lang === "en-GB") ??
        voices.find((v) => v.lang.startsWith("en")) ??
        null;
    };
    pick();
    window.speechSynthesis.addEventListener?.("voiceschanged", pick);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", pick);
      window.speechSynthesis.cancel();
    };
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) {
      onEnd?.();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice.current) u.voice = voice.current;
    u.lang = voice.current?.lang ?? "en-ZA";
    u.rate = 1;
    u.onend = () => {
      setSpeaking(false);
      onEnd?.();
    };
    u.onerror = () => {
      setSpeaking(false);
      onEnd?.();
    };
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { supported, speaking, speak, stop };
}
