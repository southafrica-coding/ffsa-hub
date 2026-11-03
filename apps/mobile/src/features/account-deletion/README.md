# Account deletion request

Me → **Request account deletion** opens `app/(app)/me/delete-account.tsx`
(`DeleteAccountScreen`). It explains what is deleted and what FFSA must keep,
takes an optional reason, and sends a **request** after a confirm sheet (never
one tap). Nothing is deleted by the app and the person stays signed in: an
admin finishes it with the existing Users tooling.

- `api.ts`: `GET / POST / DELETE /api/account/deletion-request` (the same route
  the website's `/legal/delete-account` page uses). Never sends a user id.
- `logic.ts`: the screen's state machine (`none → confirming → requesting →
  requested → confirmingCancel → cancelling → none`) and error classification.
- `strings.ts`: all copy. The delete/keep lists mirror
  `src/lib/account-deletion/config.ts` at the repo root; change both together.

Server answers the screen handles: `201`/`200` saved, `202 recorded:false`
(emailed, not saved: still a success), `503` (nothing worked: email the
office), `409` on cancel (Hub can't cancel yet: email the office), `404` on
cancel (already gone: treated as cancelled). The office address comes from the
server (`contactEmail`), falling back to `FALLBACK_CONTACT_EMAIL`.
