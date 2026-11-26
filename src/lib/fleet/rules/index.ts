// Fleet rules (vehicles-module/docs/SPEC.md section 6) as pure functions of the fleet's data
// and today's date. Ported from the FFSA Fleet app without changing any rule: if one looks
// wrong, ask Gideon before "fixing" it (vehicles-module/CLAUDE.md, non-negotiable 4).

export * from "./types";
export * from "./format";
export * from "./constants";
export * from "./checklist";
export * from "./km";
export * from "./bookings";
export * from "./schedule";
export * from "./card";
export * from "./attention";
export * from "./alerts";
export * from "./today";
export * from "./reminder";
export * from "./visits";
export * from "./notices";
