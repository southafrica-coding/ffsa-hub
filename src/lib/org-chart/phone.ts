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

/** One step in the phone directory. Kept in history so the browser Back button walks it. */
export type DirectoryScreen = {
  screen: "home" | "team" | "person";
  /** Team id, or the person id. Empty on the home list. */
  id: string;
  /** Search text to restore when this step is showing the list. */
  q: string;
  edit: boolean;
  /** Team the person was opened from, so Back returns to that roster. */
  teamId: string | null;
  /** Element to focus when this step is shown again. */
  focusId?: string;
};

export const DIRECTORY_HOME: DirectoryScreen = {
  screen: "home",
  id: "",
  q: "",
  edit: false,
  teamId: null,
};

export function directoryOpenTeam(current: DirectoryScreen, teamId: string): DirectoryScreen {
  return { screen: "team", id: teamId, q: current.q, edit: current.edit, teamId: null };
}

export function directoryOpenPerson(current: DirectoryScreen, personId: string): DirectoryScreen {
  return {
    screen: "person",
    id: personId,
    q: current.q,
    edit: current.edit,
    teamId: current.screen === "team" ? current.id : current.teamId,
  };
}

export type PersonRole = {
  teamId: string;
  teamName: string;
  title: string;
  responsibilities: string[];
};

/** Every roster seat, so a second role is not dropped in favour of the first. */
export function personRoles(model: OrgModel, userId: string): PersonRole[] {
  return model.teams.flatMap((t) =>
    t.members
      .filter((m) => m.userId === userId)
      .map((m) => ({
        teamId: t.id,
        teamName: t.name,
        title: m.title ?? (m.isLead ? "Leader" : "Member"),
        responsibilities: m.responsibilities,
      }))
  );
}

/** Name for a person screen: roster, then a Leadership row, then a key-result owner. */
export function personLabel(model: OrgModel, userId: string): string {
  for (const t of model.teams) {
    const member = t.members.find((m) => m.userId === userId);
    if (member) return member.name;
  }
  const leader = model.leaders.find((l) => l.userId === userId);
  if (leader) return leader.name;
  for (const t of model.teams) {
    for (const o of t.objectives) {
      for (const kr of o.krs) {
        if (kr.ownerId === userId && kr.ownerName) return kr.ownerName;
      }
    }
  }
  return "Person";
}

export function emptyRosterCopy(canManage: boolean): string {
  return canManage
    ? "Nobody is on this roster yet. Add people on the Ministry tab, or from Who is who."
    : "Nobody is on this roster yet.";
}

