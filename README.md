# PK Work

Task management and scrum automation for [Public Knowledge Studio](https://publicknowledge.co). A real-time web app built with Vite + vanilla JS on top of Firebase (Firestore, Cloud Functions, Hosting), with Slack integrations for daily standups and an AI studio manager.

**Live app:** [work.publicknowledge.co](https://work.publicknowledge.co)

## What it does

PK Work is a lightweight, opinionated project tracker tailored for a small design studio. It covers the full daily workflow: planning what to work on, tracking time, running standups, managing clients and billing, and keeping a people directory.

### Views

| View | Purpose |
|------|---------|
| **My Day** | Personal daily planner with a draggable time-grid calendar (9am-7pm, 15-min slots), Google Calendar overlay, up-next queue, and tomorrow planning |
| **My Tasks** | Vertical list of all tasks assigned to you, grouped by status |
| **Backlog** | Kanban board with 5 status columns (Backlog, To Do, In Progress, Review, Done) |
| **Team** | Kanban grouped by team member; drag cards between people to reassign |
| **Clients** | Kanban grouped by client |
| **Projects** | Kanban grouped by project |
| **Standup** | Scrum agenda: recently completed, in-progress by person, and items needing attention (overdue, stuck, unassigned) |
| **Timesheets** | Generate monthly time reports per client from tracked time blocks, with per-project hourly rates and a printable table |
| **Manage** | CRUD for clients (name, logo, default hourly rate, currency) and projects (name, client link, hourly rate, wiki page) |
| **People** | Directory of internal team and external contacts with profiles and wiki pages |

### Key features

- **Real-time sync** -- all changes propagate instantly via Firestore listeners; no manual refresh
- **Drag and drop** -- reassign tasks across statuses, people, clients, and projects; drag tasks onto the time grid to schedule them
- **Time blocking** -- schedule focus tasks on a visual 15-minute-slot day calendar; blocks persist to Firestore for timesheet generation
- **Google Calendar integration** -- OAuth-based overlay of today's calendar events alongside your time blocks
- **Inline task creation** -- type a task title with `@mentions` in any column footer and press Enter
- **Context menu** -- right-click any task card for quick status, assignee, priority changes, or to add to My Day
- **Status cycling** -- click a task's status icon to advance it through the workflow, with an undo toast
- **Timesheets** -- select a client and month; the app queries all team members' dailyFocus documents, cross-references tasks, and generates an itemised table with hours and amounts (using per-project hourly rates)
- **Standup board** -- structured scrum view with discussion tracking, progress bar, inline notes, and attention flags for overdue or stuck work
- **People directory** -- internal team + external contacts; each person has an editable profile and a markdown wiki page
- **Project wiki pages** -- each project has a Page tab with markdown content, tracked by editor and timestamp
- **@mentions** -- mention people and projects while creating tasks; mentions are rendered as clickable tags
- **Markdown rendering** -- wiki pages support basic markdown (headings, bold, italic, links, lists, code blocks)

## Architecture

```
Frontend (Vite + vanilla JS)
  │
  ├─ Firebase Hosting ── work.publicknowledge.co
  │
  ├─ Firestore (real-time DB)
  │   ├── tasks          Task cards (title, assignees, status, client, project, etc.)
  │   ├── dailyFocus     Per-user daily focus: task IDs + time blocks
  │   ├── standups       Daily standup entries
  │   ├── clients        Client records (name, logo, hourly rate)
  │   ├── projects       Project records (name, client link, hourly rate, wiki)
  │   ├── people         People directory (team + external contacts)
  │   ├── notes          Meeting notes
  │   └── users          Cached user profiles (photo, display name)
  │
  ├─ Cloud Functions (REST API)
  │   └── /api           CRUD endpoints authenticated via x-api-key header
  │
  └─ Slack
      ├── Scrumpy        Incoming webhook bot → posts to #daily-scrum
      └── Asty           OpenClaw AI agent (socket mode) → task management,
                         calendar, memory, proactive routines
```

## Project structure

```
src/
  config.js             Firebase config, team members, statuses, priorities
  main.js               Auth, routing, state management, global filters
  db.js                 Firestore CRUD operations (tasks, clients, projects, people, etc.)
  board.js              Kanban board views (by status, assignee, client, project)
  my-day.js             My Day view (daily focus, time grid, tomorrow planning)
  my-tasks.js           Personal task list view
  standup.js            Standup / scrum board
  timesheets.js         Timesheet generation from dailyFocus time blocks
  clients.js            Manage tab (client + project CRUD, settings, wiki pages)
  people.js             People directory (team + external contacts)
  modal.js              Task create/edit modal
  time-grid.js          Draggable time-block calendar component (9am-7pm)
  calendar.js           Google Calendar integration (OAuth, event fetching)
  context-menu.js       Right-click context menu for task cards
  mention.js            @mention dropdown for people and projects
  markdown.js           Basic markdown renderer for wiki pages
  style.css             All styles (3700+ lines)
functions/
  index.js              Cloud Functions: REST API + Slack webhook
index.html              App shell
firestore.rules         Security rules (@publicknowledge.co only)
firestore.indexes.json  Composite indexes (8 indexes)
CLAUDE.md               Detailed project documentation for AI assistants
```

## Setup

### Prerequisites

- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with Firestore, Hosting, Cloud Functions, and Storage enabled
- A Google Cloud project with the Calendar API enabled (for calendar integration)

### Install and run

```bash
npm install
npm run dev          # Start local dev server (port 3000)
```

### Deploy

```bash
npm run deploy       # Build + deploy everything (hosting + functions + rules + indexes)

# Or deploy individually:
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

### Firebase secrets

Two secrets are required for Cloud Functions:

```bash
firebase functions:secrets:set CLAUDE_API_KEY      # API key for REST endpoint auth
firebase functions:secrets:set SLACK_WEBHOOK_URL   # Scrumpy incoming webhook URL
```

## API

All endpoints require an `x-api-key` header matching `CLAUDE_API_KEY`.

**Base URL:** `https://us-central1-workdotpk-a06dc.cloudfunctions.net/api`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List tasks. Filters: `?assignee=`, `?status=`, `?clientId=`, `?projectId=` |
| POST | `/tasks` | Create task. Accepts `assignees[]` or `assignee` (string, backward compat) |
| PATCH | `/tasks/:id` | Update task. Setting `status: "done"` auto-sets `closedAt` |
| DELETE | `/tasks/:id` | Delete task |
| GET | `/scrum` | Daily scrum summary: closed yesterday + open items per person |
| POST | `/standups` | Submit standup (yesterday, today, blockers) |
| GET | `/standups` | List recent standups (limit 20). Filter: `?userEmail=` |
| GET | `/clients` | List all clients |
| GET | `/projects` | List all projects |
| GET | `/people` | List people. Filters: `?type=`, `?clientId=` |
| POST | `/people` | Create person |
| PATCH | `/people/:id` | Update person |
| DELETE | `/people/:id` | Delete person |
| GET | `/people/:id/content` | Get person wiki page |
| PATCH | `/people/:id/content` | Update person wiki page |
| GET | `/projects/:id/content` | Get project wiki page |
| PATCH | `/projects/:id/content` | Update project wiki page |
| POST | `/notes` | Save meeting notes |

## Data model

### Task statuses

`backlog` → `todo` → `in_progress` → `review` → `done`

### Task priorities

`low` | `medium` | `high` | `urgent`

### Billing

- Each **client** has a `defaultHourlyRate` and `currency` (INR or USD)
- Each **project** has its own `hourlyRate` and `currency`, inherited from its client on creation
- **Timesheets** compute per-task amounts using the project's rate (falling back to the client's default)

### Daily Focus

Each user's daily plan is stored in `dailyFocus/{email}_{YYYY-MM-DD}`:

- `taskIds[]` -- ordered list of focus tasks for the day
- `timeBlocks[]` -- array of `{ taskId, start: "HH:mm", end: "HH:mm" }` for scheduled blocks

These persist across sessions and are the source data for timesheet generation.

## Authentication

- Google Sign-In restricted to `@publicknowledge.co` accounts
- Firestore rules enforce domain-level access on all collections
- Users can only edit their own daily focus and profile
- The REST API uses a shared API key (for Asty / external integrations)

## Slack integrations

### Scrumpy

An incoming webhook bot that posts formatted daily scrum summaries to `#daily-scrum`. Triggered via the Cloud Functions webhook endpoint.

### Asty (OpenClaw)

An always-on AI studio manager that runs as an OpenClaw gateway on an Oracle Cloud free-tier VM. It connects to Slack via socket mode, with 5 tools wrapping the PK Work REST API:

- `pkwork_search` — search across clients, projects, people, tasks
- `pkwork_status` — active-work digest by scope (client / person / today / studio-wide)
- `pkwork_task_add`, `pkwork_task_set` — create and modify tasks
- `pkwork_raw` — direct REST escape hatch

Scheduled routines include daily briefings, scrum reminders, stale task detection, weekly recaps, and reference link archiving. See `CLAUDE.md` for full details.

## Team

Gyan, Charu, Sharang, Anandu
