import { driverDocRoute } from "@/lib/vehicles/driver-doc-route";

// A booking driver's passport page photo (outsiders — a Hub user's lives on their profile).
const handlers = driverDocRoute("passport");

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
