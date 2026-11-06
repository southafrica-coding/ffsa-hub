// Requests for the Me document screens.
//
// Reuses the bookings slice's request helper (src/features/bookings/http.ts)
// rather than a third copy: it already does the two things these screens
// need that the shared apiFetch doesn't — the server's own words on a 400
// ("Your health insurance expiry date can't be in the past…") and multipart
// uploads (licence / passport photos). Same bearer token, timeouts and
// 401 / deactivated handling as apiFetch.
//
// The only addition is PUT (/api/profile/update, /licence, /insurance-next,
// /household/[id] are PUT routes); the helper passes the method straight to
// fetch, so widening the type is all it takes.

import type { z } from "zod";

import { bookingsFetch } from "@/features/bookings/client";
import { UPLOAD_TIMEOUT_MS, type BookingsRequestInit } from "@/features/bookings/http";

export type ProfileRequestInit = Omit<BookingsRequestInit, "method"> & {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
};

export type ProfileFetch = <T = unknown>(path: string, init?: ProfileRequestInit & { schema?: z.ZodType<T> }) => Promise<T>;

export const profileFetch: ProfileFetch = <T,>(path: string, init?: ProfileRequestInit & { schema?: z.ZodType<T> }) =>
  bookingsFetch<T>(path, init as BookingsRequestInit & { schema?: z.ZodType<T> });

export { UPLOAD_TIMEOUT_MS };
