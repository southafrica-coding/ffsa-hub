import { toPublicAvailability, type PublicAvailabilityView } from "@/lib/missio/availability/public-view";
import { aggregateAvailabilityGrid, unansweredContacts, teamRoster } from "@/lib/missio/availability/grid";
import { formatServiceLabel } from "@/lib/missio/availability/dates";
import type { AvailabilityChoice } from "@/lib/missio/availability/grid";
import type { VolunteersSnapshot } from "@/lib/missio/availability/service";

/** Fake people only. No phone numbers, no real addresses. */
const DATES = ["2026-11-15", "2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13"];

const PEOPLE = {
  sam: { contactId: "11111111-1111-4111-8111-111111111111", name: "Sam Sample", firstName: "Sam" },
  alex: { contactId: "22222222-2222-4222-8222-222222222222", name: "Alex Example", firstName: "Alex" },
  noor: { contactId: "33333333-3333-4333-8333-333333333333", name: "Noor Demo", firstName: "Noor" },
  jo: { contactId: "44444444-4444-4444-8444-444444444444", name: "Jo Fixture", firstName: "Jo" },
};

export function emptyPublicView(): PublicAvailabilityView {
  return toPublicAvailability({
    firstName: "Sam",
    preferredName: null,
    serviceDates: DATES,
    responses: [],
    today: "2026-11-18",
  });
}

export function filledPublicView(): PublicAvailabilityView {
  return toPublicAvailability({
    firstName: "Sam",
    preferredName: null,
    serviceDates: DATES,
    today: "2026-11-23",
    responses: [
      { serviceDate: "2026-11-22", status: "available", note: "After the second song" },
      { serviceDate: "2026-11-29", status: "maybe", note: "" },
      { serviceDate: "2026-12-06", status: "unavailable", note: "" },
      { serviceDate: "2026-12-13", status: "available", note: "" },
    ],
  });
}

export function pastorGridFixture(): VolunteersSnapshot {
  const teams = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      name: "Sunday band",
      leaders: [PEOPLE.noor],
      members: [PEOPLE.sam, PEOPLE.alex],
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      name: "Welcome",
      leaders: [],
      members: [PEOPLE.jo, PEOPLE.sam],
    },
  ];
  const responses: { contactId: string; serviceDate: string; status: AvailabilityChoice }[] = [
    { contactId: PEOPLE.sam.contactId, serviceDate: "2026-11-22", status: "available" },
    { contactId: PEOPLE.sam.contactId, serviceDate: "2026-11-29", status: "available" },
    { contactId: PEOPLE.alex.contactId, serviceDate: "2026-11-22", status: "unavailable" },
    { contactId: PEOPLE.alex.contactId, serviceDate: "2026-11-29", status: "maybe" },
    ...DATES.map((serviceDate) => ({
      contactId: PEOPLE.noor.contactId,
      serviceDate,
      status: "available" as const,
    })),
  ];
  const gridInput = teams.map((team) => ({
    id: team.id,
    name: team.name,
    memberIds: team.members.map((person) => person.contactId),
    leaderIds: team.leaders.map((person) => person.contactId),
  }));
  const aggregated = aggregateAvailabilityGrid({ teams: gridInput, dates: DATES, responses });
  return {
    teams,
    requests: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        startsOn: "2026-11-15",
        endsOn: "2026-12-13",
        serviceDates: DATES,
        createdAt: "2026-11-10T08:00:00.000Z",
      },
    ],
    selectedRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    grid: aggregated.map((team) => ({
      teamId: team.teamId,
      name: team.name,
      dates: team.dates.map((cell) => ({
        serviceDate: cell.serviceDate,
        label: formatServiceLabel(cell.serviceDate, "short"),
        counts: cell.counts,
      })),
    })),
    unansweredPeople: unansweredContacts({
      contactIds: gridInput.flatMap((team) => teamRoster(team)),
      dates: DATES,
      responses,
    }).length,
  };
}
