import { z } from "zod";
import { daysBetween, isIsoDate } from "@/lib/missio/availability/dates";

const isoDate = z.string().trim().refine(isIsoDate, "Use a real date as YYYY-MM-DD.");

export const MAX_REQUEST_DAYS = 120;
export const MAX_SERVICE_DATES = 12;

export const createRequestSchema = z
  .object({
    startsOn: isoDate,
    endsOn: isoDate,
    serviceDates: z.array(isoDate).min(1).max(MAX_SERVICE_DATES),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startsOn > value.endsOn) {
      ctx.addIssue({ code: "custom", message: "The end date is before the start." });
      return;
    }
    const span = daysBetween(value.startsOn, value.endsOn);
    if (span == null || span > MAX_REQUEST_DAYS) {
      ctx.addIssue({ code: "custom", message: "Keep the range to 120 days or less." });
    }
    const unique = new Set(value.serviceDates);
    if (unique.size !== value.serviceDates.length) {
      ctx.addIssue({ code: "custom", message: "Each service date can only be listed once." });
    }
    if (value.serviceDates.some((date) => date < value.startsOn || date > value.endsOn)) {
      ctx.addIssue({ code: "custom", message: "Every service date has to sit inside the range." });
    }
  });

export const teamNameSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a team name.").max(80, "Keep the team name under 80 characters."),
  })
  .strict();

export const contactIdSchema = z
  .object({
    contactId: z.string().uuid("Choose a person from Missio."),
  })
  .strict();

export const publicSaveSchema = z
  .object({
    serviceDate: isoDate,
    status: z.enum(["available", "unavailable", "maybe"]),
    note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
  })
  .strict();

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type PublicSaveInput = z.infer<typeof publicSaveSchema>;

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the fields and try again.";
}
