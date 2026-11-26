import { rentalCron } from "@/lib/vehicles/rental-cron";

export const maxDuration = 60;

// GET /api/cron/vehicle-rental-return — daily, 05:00 UTC = 07:00 SAST. Due back tomorrow:
// the reminder (with Return early). Due back today: the return instructions, and the
// Vehicle Coordinator's "due back today" Slack message with Returned (Gideon, 24 Nov 2026).
export const GET = (request: Request) => rentalCron(request, "return");
