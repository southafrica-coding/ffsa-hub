import { rentalCron } from "@/lib/vehicles/rental-cron";

export const maxDuration = 60;

// GET /api/cron/vehicle-rental-pickup — daily, 04:30 UTC = 06:30 SAST, before the
// earliest pick-up (07:00). Bookings collected today: the person who booked gets their
// point-person instructions, every driver the driver instructions (Gideon, 24 Nov 2026).
export const GET = (request: Request) => rentalCron(request, "pickup");
