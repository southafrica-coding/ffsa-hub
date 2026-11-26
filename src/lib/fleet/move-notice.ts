// The line the person who booked reads when the Calendar's Move puts their booking on
// another vehicle (Gideon, 19 Nov 2026). It goes out through the Hub's own booking notice
// (lib/vehicles/requester-notify, kind "changed"), under the booking's details and an
// "Open in Hub" link.
export function vehicleChangedLine(from: string, to: string): string {
  return `Please be aware your vehicle has been changed from "${from}" to "${to}".`;
}
