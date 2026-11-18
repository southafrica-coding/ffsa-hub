import { canEditAvailability, formatServiceLabel, visibleServiceDates } from "@/lib/missio/availability/dates";
import type { AvailabilityChoice } from "@/lib/missio/availability/grid";
import { publicFirstName } from "@/lib/missio/availability/names";

/** The only contact columns the public lookup may select. */
export const PUBLIC_NAME_COLUMNS = "first_name, preferred_name";

export type PublicDateView = {
  serviceDate: string;
  label: string;
  editable: boolean;
  status: AvailabilityChoice | null;
  note: string;
};

export type PublicAvailabilityView = {
  state: "ready";
  firstName: string;
  dates: PublicDateView[];
};

export function toPublicAvailability(input: {
  firstName: string | null;
  preferredName: string | null;
  serviceDates: readonly string[];
  responses: readonly { serviceDate: string; status: AvailabilityChoice; note: string | null }[];
  today: string;
}): PublicAvailabilityView {
  const visible = visibleServiceDates(input.serviceDates, input.today);
  const byDate = new Map(input.responses.map((row) => [row.serviceDate, row]));
  return {
    state: "ready",
    firstName: publicFirstName({ first_name: input.firstName, preferred_name: input.preferredName }),
    dates: visible.map((serviceDate) => {
      const row = byDate.get(serviceDate);
      return {
        serviceDate,
        label: formatServiceLabel(serviceDate, "long"),
        editable: canEditAvailability(serviceDate, input.today),
        status: row?.status ?? null,
        note: row?.note ?? "",
      };
    }),
  };
}
