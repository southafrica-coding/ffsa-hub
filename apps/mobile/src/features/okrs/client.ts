// The OKR API wired to the live session (kept apart so api.ts stays testable
// without Supabase).

import { apiFetch } from "@/lib/api-client";

import { createOkrsApi } from "./api";

export const okrsApi = createOkrsApi(apiFetch);
