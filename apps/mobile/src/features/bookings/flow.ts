// The new-request flow as a pure step machine: which steps a request type
// has, where Next and Back go, and what has to be right before Next works.
// The screen only renders the current step and calls these.

import type { Person } from "./types";
import {
  driversError,
  spaceDetailsError,
  spaceWhenError,
  vehicleChoiceError,
  vehicleDetailsError,
  vehicleWhenError,
  type SpaceForm,
  type VehicleForm,
} from "./logic";

export type RequestKind = "space" | "vehicle";
export type Step = "type" | "space" | "when" | "vehicle" | "drivers" | "details" | "review";

export const STEPS: Record<RequestKind, Step[]> = {
  space: ["type", "space", "when", "details", "review"],
  vehicle: ["type", "when", "vehicle", "drivers", "details", "review"],
};

export type FlowState = {
  kind: RequestKind | null;
  step: Step;
  space: SpaceForm;
  vehicle: VehicleForm;
};

export function stepsFor(kind: RequestKind | null): Step[] {
  return kind ? STEPS[kind] : ["type"];
}

/** "Step 2 of 5" numbers (1-based). */
export function progress(s: FlowState): { index: number; total: number } {
  const steps = stepsFor(s.kind);
  return { index: Math.max(0, steps.indexOf(s.step)) + 1, total: steps.length };
}

export type StepContext = { unavailableVehicleIds: string[]; people: Person[]; today?: string };

/** Why Next can't run yet on this step, or null. */
export function stepError(s: FlowState, ctx: StepContext): string | null {
  switch (s.step) {
    case "type":
      return s.kind ? null : "Choose what you want to book.";
    case "space":
      return s.space.venueId ? null : "Please choose a venue.";
    case "when":
      return s.kind === "vehicle" ? vehicleWhenError(s.vehicle) : spaceWhenError(s.space);
    case "vehicle":
      return vehicleChoiceError(s.vehicle, ctx.unavailableVehicleIds);
    case "drivers":
      return driversError(s.vehicle, ctx.people, ctx.today);
    case "details":
      return s.kind === "vehicle" ? vehicleDetailsError(s.vehicle) : spaceDetailsError(s.space);
    case "review":
      return null;
  }
}

export function next(s: FlowState, ctx: StepContext): { state: FlowState; error: string | null } {
  const error = stepError(s, ctx);
  if (error) return { state: s, error };
  const steps = stepsFor(s.kind);
  const i = steps.indexOf(s.step);
  const to = steps[Math.min(i + 1, steps.length - 1)];
  return { state: { ...s, step: to }, error: null };
}

/** Back one step; null on the first step (the screen closes instead). */
export function back(s: FlowState): FlowState | null {
  const steps = stepsFor(s.kind);
  const i = steps.indexOf(s.step);
  if (i <= 0) return null;
  return { ...s, step: steps[i - 1] };
}

export function chooseKind(s: FlowState, kind: RequestKind): FlowState {
  return { ...s, kind };
}
