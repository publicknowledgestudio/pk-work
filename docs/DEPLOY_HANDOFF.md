# Deploy handoff — Clients page rework + leave policy

Written 2026-11-11 for whoever runs the deployment. Nothing in this commit has
been deployed. Delete this file once the deploy is done and verified.

## Where things stand

- Everything is merged into `main` and pushed to GitHub. Deploy from `main`.
- The work was committed as `eed8221` on branch `clients-page-and-leave-policy`
  (based on `98297c3`) and then merged into `main`, which by then also had
  five newer commits from someone else (Asterisk capture feed, task comments,
  client todo digest, Slack buttons — up to `c458ee8`).
- The merge had conflicts in `src/clients.js` and `src/db.js`. Those upstream
  commits had added two client fields to the old edit form
  (`clientSharedChannelId`, `defaultOwner`); the form no longer exists, so both
  fields were rebuilt on the new client page ("Channel shared with the client"
  and "Default owner"). They are not in the New client dialog — set them on
  the client page after creating.
- After the merge: `npm test` passes (225 tests), `functions` tests pass (67),
  `npm run build` succeeds, and `functions/index.js` loads.
- The previous session could not deploy: the Firebase login on that machine
  had expired, and the `firebase` CLI is not installed globally there.
- There is **no staging environment**. Project: `workdotpk-a06dc`.
- It is not known whether the five upstream commits were already deployed.
  They add functions (`pkworkSlack`, `clientTodoDigest`, `digestDryRun`) and
  rules of their own. `clientTodoDigest` is a schedule that posts to Slack.
  Check `npx firebase-tools functions:list` against `functions/index.js`
  before a full deploy, and ask Charu if any of those would be new.

## What this work contains

Two unrelated pieces of work, committed together because they shared a working
tree.

### 1. Clients page rework (built and browser-tested in demo mode)

- `src/clients.js`, `src/style.css`, `index.html`, `src/demo.js`,
  `src/clients.test.js` — new Clients page (`#/manage`): clickable logo,
  New client dialog, in-place editing, archived group, no client delete,
  "People with access".
- `src/slack-channels.js` + `functions/slack-channels.cjs` — Slack channel
  picker. Adds a **new Cloud Function, `slackChannels`** (wired in
  `functions/index.js`). Firebase ID-token auth, `@publicknowledge.co` only,
  uses the existing `SLACK_BOT_TOKEN` secret.
- `src/db.js` — `createClient` / `createProject` also store
  `slackChannelName` (display only).

Only ever exercised against demo data. The live channel list is untested.

### 2. Leave policy / monthly close (NOT reviewed by the previous session)

This was already uncommitted in the tree. It was not written, reviewed or
manually tested in that session; only the automated tests were run.

- `firestore.rules` — tightened. Notably:
  - `leaves` create/update is limited to the emails in `eligibleLeave()`
    (Sharang, Mohit, Rakesh) and to the person themself or a leave admin;
    delete is leave-admin only.
  - `holidays` and `contracts` writes become leave-admin only (Charu, Gyan).
  - new `leaveCloses` collection: admin read, no client writes.
- `functions/index.js` — leave logic refactored onto `functions/leave-policy.mjs`;
  **new Cloud Function `leaveClose`** (`functions/leave-close.cjs`).
- `functions/apply-leave-renewals.cjs` — a one-off action that rewrites
  Sharang's and Mohit's contracts for Oct 2026–Mar 2027. It only runs when an
  admin presses "Apply agreed October renewals" in the UI or POSTs
  `{action:'applyOctoberRenewals'}`. **Deploying does not run it. Do not
  trigger it** unless Charu or Gyan asks.
- Frontend: `src/attendance.js`, `src/contracts.js`, `src/leave-modal.js`,
  `src/leave-close.js`, `src/config.js`, `src/utils/contracts.js`.
- `docs/LEAVE_POLICY.md` describes the intended policy.

## Before deploying

1. Confirm with Charu that the leave work is meant to go live. A full deploy
   ships it. The frontend pieces cannot be separated from the Clients work
   without splitting the commit.
2. Confirm which Firebase account you are deploying from and that it has
   deploy rights on `workdotpk-a06dc`:
   `npx firebase-tools login:list` and `npx firebase-tools projects:list`.
3. `npm ci && (cd functions && npm ci)`, then `npm test` and `npm run build`.
4. Read the `firestore.rules` diff (`git diff 98297c3 -- firestore.rules`; this also shows the upstream rule additions).
   The rule change takes effect immediately for everyone. Check in particular
   that restricting leave creation to three people is intended — Devika, Gyan
   and Charu will not be able to create leave entries from the app.

## Deploying

`npm run deploy` runs `npm run build && firebase deploy`, which pushes
hosting, **all** functions, Firestore rules and indexes, storage rules and
database rules. If `firebase` is not on PATH, run the same thing as:

```bash
npm run build
npx firebase-tools deploy --project workdotpk-a06dc
```

If asked to go in stages instead, this order keeps the frontend from calling
things that do not exist yet:

```bash
npx firebase-tools deploy --only functions --project workdotpk-a06dc
npx firebase-tools deploy --only firestore:rules --project workdotpk-a06dc
npm run build && npx firebase-tools deploy --only hosting --project workdotpk-a06dc
```

Two functions are new (`slackChannels`, `leaveClose`). The CLI may ask about
public invoker access for new HTTPS functions; both do their own auth and are
meant to be reachable from the browser.

Do not change or rotate any secrets. Nothing here needs a new secret.

## After deploying — verify

- https://work.publicknowledge.co/#/manage loads; pick a client; the logo is
  clickable; the sidebar shows the Archived group.
- Slack channel picker: open it on any client.
  - Lists channels → working.
  - "Couldn't load the channel list" → check the function logs
    (`npx firebase-tools functions:log --only slackChannels`). `missing_scope`
    means the Slack bot lacks `channels:read` / `groups:read`; that is fixed in
    the Slack app config, not in code. Pasting a channel link or ID still works
    in the meantime, so this is not a rollback reason.
- Leaves page loads for an admin and for a non-admin team member, and an
  eligible person can still create a leave.
- **Testing writes is not free**: task and leave writes trigger Slack posts
  (`onTaskWritten`, `onLeaveWritten`) visible to the whole team. Do not create
  test clients, tasks or leaves in production without saying so; if you must,
  tell Charu first and clean up after.

## If something is wrong

- Hosting: `npx firebase-tools hosting:rollback --project workdotpk-a06dc`
  (or roll back from the Firebase console).
- Rules / functions: check out the last deployed commit (`c458ee8` if the
  upstream work was already live, otherwise `98297c3`) and redeploy that target
  (`--only firestore:rules` or `--only functions`). The two new functions can
  be left in place; nothing calls them from the old frontend.
- Report what you saw before retrying anything.

## Known, deliberately left alone

- New projects copy the client's default rate at creation; changing the
  client default later does not update existing projects.
- Clients deleted in the past may have left orphaned projects and
  `clientUsers` docs. Not cleaned up.
- The backend team roster in `functions/index.js` is still out of sync with
  `src/config.js` (see CLAUDE.md).
