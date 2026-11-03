// Website pages the Me tab links to (opened in the in-app browser).

/** The full web profile (household, documents, insurance, Slack, …). */
export const FULL_PROFILE_PATH = "/profile";

// No /privacy page exists on the website. The Hub's privacy agreement is
// served publicly at /legal/consent?kind=privacy, so the app links there.
// TODO(Jack): if a dedicated privacy policy page is published, point this at it
// (the stores also need a privacy policy URL).
export const PRIVACY_POLICY_PATH = "/legal/consent?kind=privacy";

// Apple guideline 5.1.1(v) / Google Play: the Me row opens the in-app request
// screen (me/delete-account). This public web page files the same request and
// is the fallback the screen links to (and the URL for Google Play's form).
export const ACCOUNT_DELETION_URL = "/legal/delete-account";

/** The in-app request screen. */
export const ACCOUNT_DELETION_ROUTE = "/me/delete-account";
