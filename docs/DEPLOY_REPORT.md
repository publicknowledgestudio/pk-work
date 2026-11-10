# Deploy report — Clients page rework + leave policy

Written 2026-11-11 in reply to `docs/DEPLOY_HANDOFF.md` (now deleted, as it
asked). Gyan approved shipping everything, including the leave work.

## What was deployed

Deployed from `main` at `d816a7a` to `workdotpk-a06dc`, in stages:

1. Functions — all nine. `slackChannels` and `leaveClose` were created; the
   other seven were updated.
2. Firestore rules — compiled and released.
3. Hosting — live bundle is `assets/index-DXYJ6_-n.js`, matching the local build.

Before deploying: `npm test` passed (225), the functions tests passed (67),
`npm run build` succeeded, and `functions/index.js` loaded.

Your open question is answered: `pkworkSlack`, `clientTodoDigest` and
`digestDryRun` were already live before this deploy, so `c458ee8` is the
previous deployed state for rollback purposes.

## What was verified

- https://work.publicknowledge.co serves the new bundle.
- `slackChannels` and `leaveClose` return 401 without a sign-in, with their
  own error messages, so both are up and doing their own auth.
- `api` still returns 401 without a key.
- No errors in the function logs right after the deploy.

## What was NOT verified

Nothing behind the Google sign-in was checked; the deploying session had no
signed-in browser. Still to be checked by a person on the live site:

- `#/manage` loads, the logo is clickable, the Archived group shows.
- The Slack channel picker lists channels against the real workspace (a
  `missing_scope` error means the bot lacks `channels:read` / `groups:read`).
- Leaves page loads for an admin and a non-admin, and Sharang, Mohit or
  Rakesh can still create a leave under the new rules.

No test data was written to production. "Apply agreed October renewals" was
not triggered.

## Notes for next time

- The functions tests have no npm script. Run them from the repo root with
  `npx vitest run --root functions`; `npm test` inside `functions/` fails.
- `firebase` is installed globally on Gyan's machine and logged in.
- Existing bug, not from this work: `src/main.js:656` calls `cleanupWiki()`
  on sign-out but never imports it from `src/wiki.js`. It throws on the login
  screen, so `cleanupReferences()` and `cleanupAttendance()` after it never
  run. Present since `eec0164`. Not fixed here.

Delete this file once you have read it.
