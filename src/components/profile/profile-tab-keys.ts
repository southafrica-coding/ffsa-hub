// Tab keys for /profile. Lives outside profile-tabs.tsx because that file is
// "use client": a server component importing a plain value from a client
// module gets a client reference, not the array, and crashes at render.
export const PROFILE_TABS = ["personal", "work", "slack", "legal", "records"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
