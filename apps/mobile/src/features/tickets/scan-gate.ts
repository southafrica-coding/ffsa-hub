// Scan debounce. A phone camera reports the same QR many times a second, so
// without a gate one ticket would be submitted over and over. Two rules:
//
//  1. While a scan is being handled, every other scan is ignored (the door
//     shows one result at a time).
//  2. The same code is ignored for `repeatWindowMs` after it was last
//     accepted, so a ticket held in front of the lens isn't sent twice.
//     A different code is accepted straight away.
//
// Pure (the clock is passed in) so it is unit-tested without timers.

export type ScanGate = {
  /** True if this code should be handled now; marks the gate busy. */
  accept(code: string, now: number): boolean;
  /** Call when the result for the accepted code has been handled. */
  release(): void;
  /** Forget the last code (after an undo, the same ticket may be scanned again). */
  reset(): void;
  readonly busy: boolean;
};

export const DEFAULT_REPEAT_WINDOW_MS = 3000;

export function createScanGate(repeatWindowMs = DEFAULT_REPEAT_WINDOW_MS): ScanGate {
  let busy = false;
  let lastCode: string | null = null;
  let lastAt = -Infinity;
  return {
    accept(code, now) {
      if (busy) return false;
      if (code === lastCode && now - lastAt < repeatWindowMs) return false;
      busy = true;
      lastCode = code;
      lastAt = now;
      return true;
    },
    release() {
      busy = false;
    },
    reset() {
      lastCode = null;
      lastAt = -Infinity;
    },
    get busy() {
      return busy;
    },
  };
}
