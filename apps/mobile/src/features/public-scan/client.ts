// The live, session-free fetch for scan links. Kept apart from api.ts so the
// pure contract can be unit-tested without the app's configuration.

import { getEnv } from "@/lib/env";

import { createPublicFetch } from "./api";

export const publicFetch = createPublicFetch({ baseUrl: getEnv().apiBaseUrl });
