# PK Work — Task Management for Public Knowledge Studio

## Quick Overview

This is a task management + scrum automation system for the Public Knowledge Studio team. It has a web app (Vite + vanilla JS), a Firebase backend (Firestore + Cloud Functions), and two Slack integrations:

1. **Scrumpy** — incoming webhook bot for posting formatted scrum summaries to #daily-scrum
2. **Asty** — AI studio manager (OpenClaw agent) that manages tasks, calendar, memory, and proactive routines via Slack

## Architecture

```
Frontend (Vite)  →  Firebase Hosting (work.publicknowledge.co)
                     ↓
                 Firestore (tasks, standups, clients, projects, notes)
                     ↑
Cloud Functions  →  api (REST API for CRUD, authenticated via x-api-key)
                 →  slackWebhook (posts to Slack via incoming webhook)
                     ↑
Slack            ← Scrumpy bot (incoming webhook, posts formatted summaries)
                 ← Asty / OpenClaw (socket mode, reads/writes via tools + Slack MCP)

OpenClaw Gateway → Runs on Gyan's MacBook (LaunchAgent)
                 → Plugins: openclaw-pkwork (9 tools), openclaw-mem0 (long-term memory)
                 → Workspace: ~/clawd/ (TOOLS.md, SOUL.md, etc.)
                 → Cron jobs: daily briefing, scrum reminder, stale task detection, etc.
                 → Google Calendar: via gog CLI (gyan@publicknowledge.co)
```

## Key URLs

- **Web app:** https://work.publicknowledge.co (custom domain) / https://workdotpk-a06dc.web.app
- **Firebase project:** workdotpk-a06dc
- **API endpoint:** https://us-central1-workdotpk-a06dc.cloudfunctions.net/api
- **Slack webhook endpoint:** https://us-central1-workdotpk-a06dc.cloudfunctions.net/slackWebhook
- **Slack channels:** #daily-scrum, #leaves, #references (C08UCQXH7D0)
- **Slack bots:** Scrumpy (incoming webhook), Asty (OpenClaw, socket mode)

## Project Structure

```
src/                    Frontend (Vite + vanilla JS)
  config.js             Firebase config, team members, statuses, priorities
  main.js               Auth, routing, state
  db.js                 Firestore CRUD operations
  board.js              Kanban board view
  my-tasks.js           Personal task view
  standup.js            Standup form
  references.js         Visual reference library (grid, search, moodboards)
  modal.js              Task create/edit modal
  client-board.js       Client kanban board (scoped to client org)
  client-timesheets.js  Client timesheets (aggregated, no per-person)
functions/              Cloud Functions backend
  index.js              All API endpoints (api + slackWebhook)
firestore.rules         Security rules (team + client allowlist)
firestore.indexes.json  Composite indexes (14 indexes)
CLAUDE.md               This file — project documentation
CLAUDE_SCRUM_MASTER.md  Slack interaction guide with examples
```

## Team

| Name | Email |
|------|-------|
| Gyan | gyan@publicknowledge.co |
| Charu | charu@publicknowledge.co |
| Sharang | sharang@publicknowledge.co |
| Anandu | anandu@publicknowledge.co |

Auth is restricted to @publicknowledge.co Google accounts.

## Firebase Secrets

Two secrets are set via `firebase functions:secrets:set`:
- `CLAUDE_API_KEY` — authenticates API requests (sent as `x-api-key` header). Also used by the OpenClaw pkwork plugin.
- `SLACK_WEBHOOK_URL` — Scrumpy's incoming webhook for posting to #daily-scrum

Retrieve the API key: `firebase functions:secrets:access CLAUDE_API_KEY`

## API Endpoints

All endpoints on `api` require header: `x-api-key: <CLAUDE_API_KEY>`

| Method | Path | Description |
|--------|------|-------------|
| GET | /tasks | List tasks. Filters: `?assignee=email&status=todo&clientId=x&projectId=x` |
| POST | /tasks | Create task. Body: `{ title, assignees[], status, priority, clientId, projectId, description, deadline, notes[], createdBy }` |
| PATCH | /tasks/:id | Update task. Body: any task fields. Setting `status: "done"` auto-sets `closedAt`. |
| DELETE | /tasks/:id | Delete task |
| GET | /scrum | Daily scrum summary: closed yesterday + open items per person |
| POST | /standups | Submit standup. Body: `{ userEmail, userName, yesterday, today, blockers }` |
| GET | /standups | List recent standups (limit 20). Filter: `?userEmail=` |
| GET | /clients | List all clients |
| GET | /projects | List all projects |
| POST | /notes | Store meeting notes. Body: `{ content, source, taskIds, createdBy }` |
| GET | /references | List references. Filters: `?clientId=x&projectId=x&tag=x&sharedBy=x&limit=50&offset=0` |
| POST | /references | Create reference. Body: `{ url, title, description, imageUrl, tags[], clientId, projectId, sharedBy, slackMessageTs, slackChannel }` |
| PATCH | /references/:id | Update reference fields |
| DELETE | /references/:id | Delete reference |
| GET | /references/search | Search references. Query: `?q=search+term` |
| GET | /references/preview | Fetch OG metadata for a URL. Query: `?url=https://...` Returns `{ title, description, imageUrl }` |
| GET | /moodboards | List mood boards. Filters: `?clientId=x&projectId=x` |
| POST | /moodboards | Create mood board. Body: `{ name, description, referenceIds[], clientId, projectId, createdBy }` |
| PATCH | /moodboards/:id | Update mood board |
| DELETE | /moodboards/:id | Delete mood board |

The `slackWebhook` endpoint accepts POST with `x-api-key` header and an `action` field:
- `{"action": "scrum"}` — posts daily scrum summary to #daily-scrum
- `{"action": "standup", "userEmail", "userName", "yesterday", "today", "blockers"}` — saves and posts standup
- `{"action": "create_task", "title", "assignees", ...}` — creates task and posts confirmation

### Important: assignee vs assignees

The task model was migrated from `assignee` (single string) to `assignees` (array of emails). The API and Firestore queries use `assignees` with `array-contains`. Both `createTask` and `createTaskWebhook` accept either `assignees: [...]` or `assignee: "..."` (backward compat — converts to array internally).

## Firestore Collections

- **tasks** — title, description, assignees[], status, priority, clientId, projectId, deadline, notes[], createdAt, updatedAt, closedAt, createdBy
- **standups** — userEmail, userName, yesterday, today, blockers, date
- **clients** — name (current: SCC Online, Hammock, Brunk, Presentations.ai)
- **projects** — name, clientId
- **notes** — content, source, taskIds, createdBy, createdAt
- **references** — url, title, description, imageUrl, tags[], clientId, projectId, sharedBy, slackMessageTs, slackChannel, createdAt
- **moodboards** — name, description, referenceIds[], clientId, projectId, createdBy, createdAt, updatedAt
- **clientUsers** — email (doc ID), name, clientId, invitedBy, createdAt

## Firestore Indexes

14 composite indexes deployed (see `firestore.indexes.json`):

| Collection | Fields | Purpose |
|------------|--------|---------|
| tasks | status ASC + updatedAt DESC | Filter by status |
| tasks | assignees CONTAINS + updatedAt DESC | Filter by assignee |
| tasks | assignees CONTAINS + status ASC + updatedAt DESC | Filter by assignee + status |
| tasks | clientId ASC + updatedAt DESC | Filter by client |
| tasks | projectId ASC + updatedAt DESC | Filter by project |
| standups | userEmail ASC + date DESC | Filter standups by user |
| people | type ASC + name ASC | Filter people by type |
| people | clientIds CONTAINS + name ASC | Filter people by client |
| references | clientId ASC + createdAt DESC | Filter references by client |
| references | projectId ASC + createdAt DESC | Filter references by project |
| references | tags CONTAINS + createdAt DESC | Filter references by tag |
| references | sharedBy ASC + createdAt DESC | Filter references by who shared |
| moodboards | clientId ASC + updatedAt DESC | Filter moodboards by client |
| moodboards | projectId ASC + updatedAt DESC | Filter moodboards by project |

**Gotcha:** The `assignees` field uses `arrayConfig: "CONTAINS"` (not `order: "ASCENDING"`). If you add a new query combination with `assignees`, you'll need a new composite index. Firestore will return a 500 error if the index doesn't exist — the error message includes a link to create it.

## Task Statuses & Priorities

Statuses: backlog, todo, in_progress, review, done
Priorities: low, medium, high, urgent

Status emojis (used by Asty in Slack):
- 📋 backlog
- 📌 todo
- 🔨 in_progress
- 👀 review
- ✅ done
- 🔥 urgent (priority)

## Asty — OpenClaw AI Studio Manager

Asty is an always-on AI agent that acts as the studio manager for Public Knowledge. It runs as an OpenClaw gateway on Gyan's MacBook via LaunchAgent.

### OpenClaw Setup

```
~/.openclaw/
  openclaw.json           # Main config (plugins, Slack tokens, gateway settings)
  extensions/
    openclaw-pkwork/      # PK Work task management plugin (9 tools)
    openclaw-mem0/        # Long-term memory via Mem0 platform
    openclaw-supermemory/ # Disabled — using mem0 instead
  cron/
    jobs.json             # Scheduled cron jobs
  logs/
    gateway.log           # stdout
    gateway.err.log       # stderr

<<<<<<< HEAD
~/clawd/                  # OpenClaw workspace (symlinks → ~/knowledge-base/config/)
  TOOLS.md                # Studio Manager instructions, tools, routines
  SOUL.md                 # Agent personality
  HEARTBEAT.md            # Periodic task instructions
  USER.md                 # User profile
  IDENTITY.md             # Agent identity (named after the * in PK logo)
  AGENTS.md               # Agent definitions
=======
~/knowledge-base/         # asty-kb GitHub repo (pulled every 5 min via crontab)
  config/
    TOOLS.md              # Studio Manager instructions, tools, routines
    SOUL.md               # Agent personality
    HEARTBEAT.md          # Periodic task instructions
    USER.md               # User profile
    IDENTITY.md           # Agent identity (named after the * in PK logo)
    AGENTS.md             # Agent definitions

~/clawd/                  # OpenClaw workspace (symlinks → ~/knowledge-base/config/)
  *.md → ../knowledge-base/config/*.md
>>>>>>> 7cfa2e5dbbc6e49eff74796368fe818cb5c58885
```

**Config sync:** These files live in the `asty-kb` GitHub repo under `config/`. On the VM, `~/clawd/*.md` are symlinks to `~/knowledge-base/config/*.md`. A crontab entry pulls the repo every 5 minutes: `*/5 * * * * cd ~/knowledge-base && git pull --rebase --quiet`. The old Firestore-based config-sync cron job has been disabled.

### OpenClaw Plugin: openclaw-pkwork

Provides 9 tools that wrap the PK Work REST API:

| Tool | API Call | Purpose |
|------|----------|---------|
| `pkwork_list_tasks` | GET /tasks | View tasks with optional filters |
| `pkwork_create_task` | POST /tasks | Create new task |
| `pkwork_update_task` | PATCH /tasks/:id | Update task status, assignee, priority, etc. |
| `pkwork_delete_task` | DELETE /tasks/:id | Delete a task |
| `pkwork_scrum_summary` | GET /scrum | Get daily scrum summary |
| `pkwork_submit_standup` | POST /standups | Record a standup |
| `pkwork_list_standups` | GET /standups | View recent standups |
| `pkwork_list_clients` | GET /clients | List all clients |
| `pkwork_list_projects` | GET /projects | List all projects |

**Config:** API key is stored directly in `openclaw.json` under `plugins.entries.openclaw-pkwork.config.apiKey` (not env vars — LaunchAgent env propagation doesn't work reliably with OpenClaw plugins).

### OpenClaw Plugin: openclaw-mem0

Long-term memory via Mem0 platform. Configured with:
- `mode: "platform"` (uses Mem0 cloud API)
- `autoCapture: true` (automatically stores useful info from conversations)
- `autoRecall: true` (automatically recalls relevant memories)
- `userId: "gyan"`
- Liberal storage instructions — stores decisions, client preferences, design feedback, recurring patterns, meeting outcomes, deadlines, workflow quirks

### Slack Integration

Asty connects to Slack via socket mode (not webhooks):
- **Bot token:** stored in `openclaw.json` → `channels.slack.botToken`
- **App token:** stored in `openclaw.json` → `channels.slack.appToken`
- **Channels:** #daily-scrum, #leaves, #references
- **Thread config:** `initialHistoryLimit: 50`, `inheritParent: true`, `historyScope: "thread"` — so Asty can read full thread context including who posted what

### Cron Jobs (Scheduled Routines)

| Job | Schedule | Channel/Target | Purpose |
|-----|----------|----------------|---------|
| daily-briefing | 9:00 AM weekdays | DM to Gyan | Calendar + tasks overview |
| mem0-sync | 9:30 AM weekdays | (internal) | Sync PK Work task data into mem0 |
| daily-scrum-reminder | 9:58 AM weekdays | #daily-scrum | Reminder to post standups |
| stale-task-check | 2:00 PM weekdays | #daily-scrum | Flag in_progress 3+ days, review 2+ days |
| friday-weekly-recap | 5:00 PM Fridays | #daily-scrum | Weekly done/in-progress/stuck/upcoming |
| references-sync | 8:00 PM weekdays | (internal) | Scan #references, store links into mem0 |

### Google Calendar Integration

Asty has access to Gyan's Google Calendar via the `gog` CLI tool (`gyan@publicknowledge.co`).

Key behaviors:
- **Always invite attendees** when creating meetings (use `--attendees` flag)
- **"Team calendar"** = all 4 members invited
- **Leave/OOO** = all-day event with name in title (e.g., "Anandu — Leave"), invite entire team. Only use timed events if someone explicitly says "half day"
- **Meeting prep** — before client meetings, DM Gyan a brief with task status for that client

### #references Channel (C08UCQXH7D0)

Asty passively watches #references and stores design references, inspiration links, Figma files, articles into mem0. Does not post in the channel unless asked. Recalls references when someone asks "what was that site Charu shared?" etc.

## Common Commands

```bash
# Frontend
npm run dev                           # Local dev server (port 3000)
npm run build                         # Build to dist/
npm run deploy                        # Build + deploy everything

# Firebase
firebase deploy --only functions      # Deploy functions only
firebase deploy --only hosting        # Deploy hosting only
firebase deploy --only firestore:rules        # Deploy security rules
firebase deploy --only firestore:indexes      # Deploy composite indexes

# Firestore indexes (check status after deploy)
gcloud firestore indexes composite list --project=workdotpk-a06dc

# Firebase secrets
firebase functions:secrets:set CLAUDE_API_KEY
firebase functions:secrets:access CLAUDE_API_KEY

# OpenClaw (Asty)
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.gateway.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.gateway.plist
# Or: launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

## Known Gotchas

1. **Firestore index errors:** If a new query combination returns 500, it's almost always a missing composite index. The error message includes a direct link to create it in the Firebase Console. Or add to `firestore.indexes.json` and deploy.

2. **OpenClaw env vars:** Don't rely on `process.env` in OpenClaw plugins — LaunchAgent env vars don't propagate reliably. Put secrets directly in `openclaw.json` plugin config.

3. **Assignee migration:** Old tasks may have `assignee` (string), new ones have `assignees` (array). The `getAssignees()` helper in `functions/index.js` handles backward compat. The API accepts both formats on create.

4. **Slack thread context:** Asty needs thread config (`initialHistoryLimit: 50`, `inheritParent: true`) to read who posted what in threads. Without this, it can't identify the original poster — leading to wrong actions (e.g., adding leave to the wrong person's calendar).

5. **Config source of truth:** Asty's 6 config files (SOUL.md, TOOLS.md, AGENTS.md, IDENTITY.md, USER.md, HEARTBEAT.md) live in the `asty-kb` GitHub repo under `config/`. On the VM, `~/clawd/*.md` are symlinks to `~/knowledge-base/config/*.md`, and a crontab entry pulls the repo every 5 minutes. The old config-sync cron job (which fetched configs from Firestore via `pkwork_get_agent_config`) is disabled.

## Client Login

External client users can log in via Google sign-in to view their org's tasks and timesheets. Access is controlled by a `clientUsers/{email}` allowlist in Firestore.

**Role detection flow:**
1. User signs in with Google
2. If email ends with `@publicknowledge.co` → team role (full access)
3. Else check `clientUsers/{email}` doc exists → client role (scoped access)
4. Else → access denied, auto-sign-out

**Client routes:** `#client-board` (kanban scoped to clientId), `#client-timesheets` (aggregated, no per-person breakdown)

**Firestore rules:** `isClientUser()` checks if `request.auth.token.email` exists in `clientUsers`. `clientIdForUser()` returns the clientId for a client user. Client users can only read tasks/projects matching their clientId.

**Managing client users:** Team members invite client users from the Manage page → Client Users section. Each entry stores email, name, clientId, and invitedBy.

## Clients

Current clients in Firestore:
- SCC Online (SCC) — website redesign, content strategy
- Hammock — brand identity, packaging
- Brunk — brand identity, social media
- Presentations.ai — SaaS product, blog content
- Public Knowledge (internal) — studio website, internal tools
