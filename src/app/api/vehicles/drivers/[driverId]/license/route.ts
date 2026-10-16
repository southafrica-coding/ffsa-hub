import { driverDocRoute } from "@/lib/vehicles/driver-doc-route";

// A booking driver's licence file (outsiders — a Hub user's lives on their profile).
const handlers = driverDocRoute("license");

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
