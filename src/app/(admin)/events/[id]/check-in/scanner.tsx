"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { cn } from "@/lib/utils/cn";

type OkResult = {
  result: "ok";
  ticketTypeName: string;
  buyerName: string;
};
type AlreadyResult = {
  result: "already_checked_in";
  ticketTypeName: string;
  checkedInAt: string;
};
type RejectedResult = { result: "void" | "invalid" | "wrong_event" };
type ErrorResult = { result: "error"; error: string };
type ScanResult = OkResult | AlreadyResult | RejectedResult | ErrorResult;

type DisplayItem = {
  id: number;
  code: string;
  result: ScanResult;
  at: number;
};

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

// Longest edge we hand the decoder. Full-res frames from a modern phone
// camera are 1080p+; downscaling keeps each decode well under the frame
// budget without hurting read rate at door distance.
const DECODE_MAX_EDGE = 640;

// How long the verdict stays over the viewfinder before it clears itself.
// Long enough to read at a moving door, short enough that the next person's
// scan is never read as the last person's.
const VERDICT_MS = 4000;

export function Scanner({ eventId }: { eventId: string; eventTitle?: string }) {
  const [scanning, setScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScannedRef = useRef<string>("");
  const lastScannedAtRef = useRef<number>(0);
  const itemIdRef = useRef<number>(0);

  const latest = items[0];
  const [verdictVisible, setVerdictVisible] = useState(false);

  // Clear the verdict a few seconds after each scan so a stale "checked in"
  // can't be mistaken for the person currently at the door.
  useEffect(() => {
    if (!latest) return;
    setVerdictVisible(true);
    const t = setTimeout(() => setVerdictVisible(false), VERDICT_MS);
    return () => clearTimeout(t);
  }, [latest]);

  // Cleanup camera on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  async function startCamera() {
    setCameraError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      // getUserMedia only exists on secure origins (https / localhost).
      setCameraError(
        "This browser won't give the page camera access. Open the Hub over https, or type the code by hand."
      );
      setManualOpen(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch (e) {
      setCameraError(
        e instanceof Error
          ? e.message
          : "Couldn't open the camera. Check the site has camera permission."
      );
      setManualOpen(true);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  const processScan = useCallback(
    async (code: string) => {
      const id = ++itemIdRef.current;
      setBusy(true);
      let result: ScanResult;
      try {
        const res = await fetch(`/api/events/${eventId}/check-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          result = {
            result: "error",
            error: data.error ?? `Request failed (${res.status})`,
          };
        } else {
          result = (await res.json()) as ScanResult;
        }
      } catch (e) {
        result = {
          result: "error",
          error: e instanceof Error ? e.message : "Network error",
        };
      }
      setBusy(false);
      setItems((prev) =>
        [{ id, code, result, at: Date.now() }, ...prev].slice(0, 20)
      );
      // A short buzz on reject — at a loud door the screen colour is easy to
      // miss. navigator.vibrate is a no-op where it isn't supported.
      if (result.result !== "ok" && typeof navigator !== "undefined") {
        navigator.vibrate?.(180);
      }
    },
    [eventId]
  );

  // Scan loop — runs while `scanning` is true.
  //
  // Decoding is two-tier: the native BarcodeDetector where the browser has
  // it (Android Chrome, Chrome on macOS), and a jsQR canvas decode
  // everywhere else. Safari — iOS and macOS — and Firefox ship no
  // BarcodeDetector at all.
  useEffect(() => {
    if (!scanning) return;

    const Ctor = (
      window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
    ).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;

    let cancelled = false;

    const readFrame = async (): Promise<string | null> => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return null;

      if (detector) {
        const codes = await detector.detect(video);
        return codes[0]?.rawValue ?? null;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      const scale = Math.min(1, DECODE_MAX_EDGE / Math.max(vw, vh));
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);

      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      const frame = ctx.getImageData(0, 0, w, h);
      // dontInvert: ticket QRs are always dark-on-light, and skipping the
      // inverted pass roughly halves the per-frame cost.
      const found = jsQR(frame.data, w, h, { inversionAttempts: "dontInvert" });
      return found?.data ?? null;
    };

    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const code = await readFrame();
        if (!code) return;
        const now = Date.now();
        // De-dup: ignore the same code re-scanned within 3 seconds.
        if (
          code === lastScannedRef.current &&
          now - lastScannedAtRef.current < 3000
        ) {
          return;
        }
        lastScannedRef.current = code;
        lastScannedAtRef.current = now;
        await processScan(code);
      } catch {
        /* Frame-decode errors during normal scanning are expected — ignore. */
      }
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scanning, processScan]);

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const code = manual.trim();
    if (!code) return;
    await processScan(code);
    setManual("");
  }

  return (
    <div>
      {/* ── Viewfinder ──────────────────────────────────────────
          Sized off the viewport, not a fixed 16:9 box. A phone camera
          is portrait and a door is scanned at arm's length, so the
          frame gets most of the screen; the old landscape strip left
          the QR a few millimetres wide. */}
      <div className="relative w-full overflow-hidden border border-ink bg-ink h-[60vh] supports-[height:1dvh]:h-[60dvh] max-h-[620px] min-h-[320px] md:h-auto md:max-h-none md:aspect-[4/3]">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          playsInline
        />

        {/* Aiming brackets — the QR only has to land inside these. */}
        {scanning && !verdictVisible && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[62%] w-[78%] max-w-[380px]">
              {[
                "left-0 top-0 border-l-2 border-t-2",
                "right-0 top-0 border-r-2 border-t-2",
                "left-0 bottom-0 border-l-2 border-b-2",
                "right-0 bottom-0 border-r-2 border-b-2",
              ].map((pos) => (
                <span
                  key={pos}
                  className={cn("absolute h-9 w-9 border-yellow", pos)}
                />
              ))}
            </div>
          </div>
        )}

        {!scanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink px-6 text-center">
            <p className="font-mono text-[10px] font-bold uppercase tracking-label text-white/60">
              Camera off
            </p>
            <p className="max-w-[22ch] text-sm text-white/80">
              Start the scanner, then hold a ticket QR inside the frame.
            </p>
          </div>
        )}

        {/* ── Verdict, over the frame ──────────────────────────
            The door needs one glance, not a scroll. The last result
            covers the viewfinder in a colour readable at arm's length
            and clears itself after a few seconds. */}
        {verdictVisible && latest && (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 animate-fade-up px-5 py-4",
              verdictTone(latest.result)
            )}
          >
            <p className="font-display text-[30px] leading-none uppercase md:text-[38px]">
              {resultMessage(latest.result)}
            </p>
            <p className="mt-1.5 text-sm font-semibold">
              {verdictDetail(latest.result)}
            </p>
          </div>
        )}

        {busy && (
          <div className="absolute right-3 top-3">
            <span className="border border-white/40 bg-ink/70 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-chip text-white">
              Checking…
            </span>
          </div>
        )}
      </div>

      {/* ── Controls ───────────────────────────────────────── */}
      <div className="mt-3 flex gap-2">
        {scanning ? (
          <button
            type="button"
            onClick={stopCamera}
            className="flex-1 border border-ink bg-white px-4 py-3.5 font-mono text-[11px] font-bold uppercase tracking-chip text-ink transition-colors hover:bg-bone"
          >
            Stop scanner
          </button>
        ) : (
          <button
            type="button"
            onClick={startCamera}
            className="flex-1 border border-ink bg-ink px-4 py-3.5 font-mono text-[11px] font-bold uppercase tracking-chip text-white transition-opacity hover:opacity-90"
          >
            Start scanning
          </button>
        )}
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          aria-expanded={manualOpen}
          className="border border-rule-strong bg-white px-4 py-3.5 font-mono text-[11px] font-bold uppercase tracking-chip text-ink transition-colors hover:bg-bone"
        >
          Type code
        </button>
      </div>

      {cameraError && (
        <p className="mt-2 text-xs text-destructive">{cameraError}</p>
      )}

      {manualOpen && (
        <form onSubmit={submitManual} className="mt-2 flex gap-2">
          <input
            type="text"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Ticket code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 border border-rule-strong bg-white px-3 py-3 font-mono text-sm text-ink placeholder:text-[var(--text-tertiary)] focus:border-ink focus:outline-none"
          />
          <button
            type="submit"
            className="border border-ink bg-ink px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-chip text-white transition-opacity hover:opacity-90"
          >
            Check in
          </button>
        </form>
      )}

      {/* ── Recent scans ───────────────────────────────────── */}
      <div className="mt-7">
        <div className="section-bar">
          <span className="section-bar-title">Recent scans</span>
          {items.length > 0 && (
            <span className="section-bar-meta">
              {items.filter((i) => i.result.result === "ok").length} in
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="border border-t-0 border-rule bg-white px-4 py-5 text-sm text-[var(--text-secondary)]">
            No scans yet.
          </p>
        ) : (
          <ul className="border border-t-0 border-rule bg-white">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "font-mono text-[10px] font-bold uppercase tracking-chip",
                      rowTone(it.result)
                    )}
                  >
                    {resultMessage(it.result)}
                  </p>
                  <p className="mt-1 truncate text-sm text-ink">
                    {verdictDetail(it.result)}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-tertiary)]">
                    {it.code}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-[10px] tabular text-[var(--text-tertiary)]">
                  {new Date(it.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function resultMessage(r: ScanResult): string {
  switch (r.result) {
    case "ok":
      return "Checked in";
    case "already_checked_in":
      return "Already in";
    case "void":
      return "Voided — reject";
    case "invalid":
      return "Invalid — reject";
    case "wrong_event":
      return "Wrong event";
    case "error":
      return "Error";
  }
}

/** The line under the verdict: who / which ticket / why. */
function verdictDetail(r: ScanResult): string {
  switch (r.result) {
    case "ok":
      return [r.buyerName, r.ticketTypeName].filter(Boolean).join(" · ");
    case "already_checked_in":
      return `${r.ticketTypeName} · scanned ${new Date(
        r.checkedInAt
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    case "void":
      return "This ticket was cancelled or refunded.";
    case "invalid":
      return "No ticket matches this code.";
    case "wrong_event":
      return "This ticket belongs to a different event.";
    case "error":
      return r.error;
  }
}

/** Filled, not outlined — this is read at arm's length in bad light. */
function verdictTone(r: ScanResult): string {
  switch (r.result) {
    case "ok":
      return "bg-grass text-white";
    case "already_checked_in":
      return "bg-yellow text-ink";
    default:
      return "bg-destructive text-white";
  }
}

function rowTone(r: ScanResult): string {
  switch (r.result) {
    case "ok":
      return "text-grass-text";
    case "already_checked_in":
      return "text-amber";
    default:
      return "text-destructive";
  }
}
