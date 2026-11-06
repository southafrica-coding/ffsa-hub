// The one yellow band on the phone directory. Stuck first, then a missing
// monthly update, then a team that has people and nobody named as lead.
// Pure so the priority can be tested without rendering the page.

import type { OrgModel } from "./model";

export type PhoneAttention = { n: string; text: string };

export function phoneAttention(model: OrgModel): PhoneAttention | null {
  const stuck = model.teams.reduce(
    (n, t) => n + t.objectives.reduce((m, o) => m + o.krs.filter((k) => k.state === "stuck").length, 0),
    0
  );
  if (stuck > 0) {
    return {
      n: String(stuck),
      text: stuck === 1 ? "key result is stuck and needs help" : "key results are stuck and need help",
    };
  }
  const silent = model.teams.filter((t) => t.objectives.length > 0 && !t.updated).length;
  if (silent > 0) {
    return {
      n: String(silent),
      text:
        silent === 1
          ? `team hasn't sent the ${model.updateMonthLabel} OKR update`
          : `teams haven't sent the ${model.updateMonthLabel} OKR update`,
    };
  }
  const noLead = model.teams.filter((t) => t.headcount > 0 && t.leads.length === 0).length;
  if (noLead > 0) {
    return {
      n: String(noLead),
      text: noLead === 1 ? "team has people on it and nobody named as lead" : "teams have people on them and nobody named as lead",
    };
  }
  return null;
}
