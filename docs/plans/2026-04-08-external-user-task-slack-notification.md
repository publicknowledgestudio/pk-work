# External User Task Creation — Slack Notification

**Date:** 2026-04-08
**Status:** Approved

## Goal

When an external (client) user creates a task from the client board, post a notification to the client's Slack channel.

## Approach

Extend the existing `onTaskWritten` Firestore trigger in `functions/index.js`. No frontend changes.

## Logic

Inside `onTaskWritten`, after the existing "task done" notification block:

1. Detect new task: `before` doesn't exist
2. Check if external user: `createdBy` exists and does NOT end with `@publicknowledge.co`
3. Look up `clientUsers/{createdBy}` for display name
4. Look up `clients/{clientId}` for `slackChannelId`
5. Reuse `lookupProjectName()` for project name
6. Post via existing `postToSlackChannel()`

## Message Format

```
📋 New task created by external user "Sarah" — Redesign homepage hero section
Website Redesign · SCC Online
```

Second line: project name if available, otherwise just client name.

## Edge Cases

- No `slackChannelId` on client — skip silently
- No `clientUsers` doc — fall back to email prefix as name
- No project — show just client name on second line
- Team member creates task — skip (only fires for non-PK emails)

## Files Changed

- `functions/index.js` — `onTaskWritten` trigger only

## No new secrets, indexes, or dependencies needed.
