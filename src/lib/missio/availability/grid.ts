export type AvailabilityChoice = "available" | "unavailable" | "maybe";

export type GridCounts = {
  available: number;
  unavailable: number;
  maybe: number;
  unanswered: number;
};

export type GridResponse = {
  contactId: string;
  serviceDate: string;
  status: AvailabilityChoice;
};

export type GridTeamInput = {
  id: string;
  name: string;
  memberIds: readonly string[];
  leaderIds?: readonly string[];
};

export type GridTeamResult = {
  teamId: string;
  name: string;
  dates: { serviceDate: string; counts: GridCounts }[];
};

const EMPTY: GridCounts = { available: 0, unavailable: 0, maybe: 0, unanswered: 0 };

/** Leaders and members count once per team. A person on two teams counts on both. */
export function teamRoster(team: Pick<GridTeamInput, "memberIds" | "leaderIds">): string[] {
  return [...new Set([...(team.memberIds ?? []), ...(team.leaderIds ?? [])])];
}

export function aggregateAvailabilityGrid(input: {
  teams: readonly GridTeamInput[];
  dates: readonly string[];
  responses: readonly GridResponse[];
}): GridTeamResult[] {
  const dates = [...input.dates];
  const byContactDate = new Map<string, AvailabilityChoice>();
  for (const row of input.responses) {
    byContactDate.set(`${row.contactId}|${row.serviceDate}`, row.status);
  }

  return input.teams.map((team) => {
    const roster = teamRoster(team);
    return {
      teamId: team.id,
      name: team.name,
      dates: dates.map((serviceDate) => {
        const counts: GridCounts = { ...EMPTY };
        for (const contactId of roster) {
          const status = byContactDate.get(`${contactId}|${serviceDate}`);
          if (status === "available") counts.available += 1;
          else if (status === "unavailable") counts.unavailable += 1;
          else if (status === "maybe") counts.maybe += 1;
          else counts.unanswered += 1;
        }
        return { serviceDate, counts };
      }),
    };
  });
}

/**
 * People on any team who have not answered every service date that is still
 * open. A date before `today` (Johannesburg) is ignored. Maybe counts as an answer.
 */
export function unansweredContacts(input: {
  contactIds: readonly string[];
  dates: readonly string[];
  responses: readonly { contactId: string; serviceDate: string }[];
  today: string;
}): string[] {
  const openDates = input.dates.filter((date) => date >= input.today);
  const answered = new Map<string, Set<string>>();
  for (const row of input.responses) {
    const set = answered.get(row.contactId) ?? new Set<string>();
    set.add(row.serviceDate);
    answered.set(row.contactId, set);
  }
  return [...new Set(input.contactIds)].filter((contactId) => {
    const set = answered.get(contactId);
    return openDates.some((date) => !set?.has(date));
  });
}
