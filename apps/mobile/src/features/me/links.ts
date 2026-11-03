// Website pages the Me tab links to (opened in the in-app browser).

/** The full web profile (household, documents, insurance, Slack, …). */
export const FULL_PROFILE_PATH = "/profile";

// No /privacy page exists on the website. The Hub's privacy agreement is
// served publicly at /legal/consent?kind=privacy, so the app links there.
// TODO(Jack): if a dedicated privacy policy page is published, point this at it
// (the stores also need a privacy policy URL).
export const PRIVACY_POLICY_PATH = "/legal/consent?kind=privacy";

// TODO(Jack): Apple guideline 5.1.1(v) expects an in-app way to start account
// deletion. The Hub has no deletion-request mechanism yet (no route, no
// mailbox), so the row is shown disabled. Set this to a web path or mailto:
// once one exists.
export const ACCOUNT_DELETION_URL: string | null = null;
