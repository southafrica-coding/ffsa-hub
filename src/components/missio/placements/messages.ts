import type { PlacementView } from "@/lib/missio/placements";

const DEADLINE = new Intl.DateTimeFormat("en-ZA", { weekday: "long", timeZone: "UTC" });

function houseTitle(house: PlacementView["house"]): string {
  return house.name?.trim() || `House ${house.number}`;
}

function firsts(names: string[]): string {
  const list = names.map((name) => name.split(" ")[0]).filter(Boolean);
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} & ${list[list.length - 1]}`;
}

/** The two messages a pastor sends when placing someone (board M12a). Plain text for WhatsApp. */
export function placementMessages(view: PlacementView, origin: string, pastorName = "") {
  const person = view.person.name.split(" ")[0] || "there";
  const house = houseTitle(view.house);
  const day = view.house.meetingDay ? `${view.house.meetingDay.charAt(0).toUpperCase()}${view.house.meetingDay.slice(1)}s` : "";
  const leaders = firsts(view.leaders.map((leader) => leader.name));
  const leadOne = view.leaders[0]?.name.split(" ")[0] ?? "";
  const by = DEADLINE.format(new Date(`${view.leaderDeadline}T12:00:00Z`));
  const links = view.links ? { person: `${origin}${view.links.person}`, leader: `${origin}${view.links.leader}` } : null;
  const from = pastorName ? `${pastorName} from Missio here. ` : "";
  const toPerson = [
    `Hi ${person} 👋 ${from}We’ve found you a house church: ${house}${day ? `, ${day}` : ""}.`,
    leaders ? ` ${leaders} ${view.leaders.length > 1 ? "lead" : "leads"} it${leadOne ? ` and ${leadOne} will message you this week` : ""}.` : "",
    links ? ` Your next steps: ${links.person}` : "",
  ].join("");
  const toLeader = [
    `${leadOne || "Hi"}, ${view.person.name || "someone new"} is joining ${house} 🙌`,
    ` Please say hi by ${by}${view.person.phone ? ` (${view.person.phone})` : ""}.`,
    links ? ` Tap when done: ${links.leader}` : "",
  ].join("");
  return { toPerson, toLeader };
}
