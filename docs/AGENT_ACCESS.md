# Giving an external agent access to PK Work

Everything an agent needs to read and write PK Work data, without repo access,
Firebase credentials, or a Google login.

There are two ways in. Pick one.

---

## Option A — MCP (preferred)

PK Work already ships an MCP server. If the agent supports MCP, use this: it
gets typed tools and schemas instead of having to learn REST by trial.

| | |
|---|---|
| **Endpoint** | `https://us-central1-workdotpk-a06dc.cloudfunctions.net/mcp` |
| **Transport** | Streamable HTTP, **stateless — POST only**. `GET` returns 405. |
| **Auth** | `Authorization: Bearer <POKE_MCP_KEY>` |
| **Server name** | `pk-work` v1.0.0 |
| **Source** | [functions/mcp.js](functions/mcp.js), wired up at [functions/index.js:715](functions/index.js:715) |

Note the key is **`POKE_MCP_KEY`**, not the REST key — a separate secret, so you
can revoke MCP access without breaking Asty. Retrieve it with:

```bash
firebase functions:secrets:access POKE_MCP_KEY
```

Internally the MCP server calls the REST API with `CLAUDE_API_KEY` on the
agent's behalf; the client never sees that key.

### Tools exposed

| Tool | Does |
|------|------|
| `pkwork_search` | Free-text search across clients, projects, people, tasks |
| `pkwork_status` | Active-work digest for a scope (studio-wide, client, person, or `today`) |
| `pkwork_task_add` | Create a task |
| `pkwork_task_set` | Update a task by ID, or delete with `delete=true` |
| `pkwork_raw` | Escape hatch — any REST call to the endpoints below |

---

## Option B — REST directly

For agents without MCP support. This is what `PK_WORK_API_KEY` in the agent's
`.env` is for.

- **Base URL:** `https://us-central1-workdotpk-a06dc.cloudfunctions.net/api`
- **Auth header:** `x-api-key: $PK_WORK_API_KEY`
  (the value is the `CLAUDE_API_KEY` secret — the env var name differs, the
  header name does not)
- Missing or wrong key → `401 {"error":"Unauthorized"}`
- CORS is open (`*`) and `OPTIONS` is handled, so browser-side calls work too.

Smoke test:

```bash
curl -s -H "x-api-key: $PK_WORK_API_KEY" "https://us-central1-workdotpk-a06dc.cloudfunctions.net/api/status"
```

### Endpoints

Routing is manual path-matching ([functions/index.js:81](functions/index.js:81)),
so only the exact method + segment-count combinations below exist. Anything else
returns `404 {"error":"Not found"}` — including plausible-looking routes like
`GET /tasks/:id` and `PATCH /clients/:id`, which are **not** implemented.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/tasks` | Filters: `?assignee=&status=&clientId=&projectId=` |
| POST | `/tasks` | Body: `{ title, assignees[], status, priority, clientId, projectId, description, deadline, notes[], createdBy }` |
| PATCH | `/tasks/:id` | Any task field. `status:"done"` auto-stamps `closedAt`. |
| DELETE | `/tasks/:id` | |
| GET | `/search` | `?q=term` — substring, case-insensitive |
| GET | `/status` | `?scope=` client name, person first-name, `today`, or omit for studio-wide. Returns counts **plus** active task lists and the client's `slackChannelId`. |
| GET | `/scrum` | Closed-yesterday + open-items per person |
| GET/POST | `/standups` | POST `{ userEmail, userName, yesterday, today, blockers }`; GET filters `?userEmail=` |
| GET/POST | `/people` | |
| GET/PATCH/DELETE | `/people/:id` | Plus `/people/:id/content` (GET/PATCH) for page content |
| GET | `/clients` | **Call this first** — most filters need `clientId`, not a name |
| GET | `/projects` | `?clientId=`; plus `/projects/:id/content` (GET/PATCH) |
| POST | `/notes` | `{ content, source, taskIds, createdBy }` |
| GET | `/processes`, `/processes/:id` | |
| GET/POST | `/references` | Filters: `?clientId=&projectId=&tag=&sharedBy=&limit=&offset=` |
| PATCH/DELETE | `/references/:id` | |
| GET | `/references/search` | `?q=` |
| GET | `/references/preview` | `?url=` → `{ title, description, imageUrl }` (OG scrape) |
| GET/POST | `/moodboards`, PATCH/DELETE `/moodboards/:id` | |
| GET | `/leaves` | `?userEmail=&status=&startDate=&endDate=` |
| POST | `/leaves` | `{ userEmail, userName, type, startDate, endDate, halfDay }` |
| PATCH | `/leaves/:id` | Cancel only |
| GET | `/leaves/balances` | Accrued / used / available per person |

---

## What the agent must be told up front

It cannot discover any of this by poking the API. Put it in the system prompt.

**Enums — exact strings, no others accepted:**

- Task status: `backlog`, `todo`, `in_progress`, `review`, `done`
- Task priority: `low`, `medium`, `high`, `urgent`
- Leave type: `personal`, `medical`, `overtime` (anything else → 400)

**Assignees are an array.** The model migrated from `assignee` (string) to
`assignees` (array of emails). Create accepts either and normalises; reads
always return the array. Filtering uses Firestore `array-contains`.

**Team emails** (all `@publicknowledge.co`): `gyan`, `charu`, `sharang`,
`mohit`, `rakesh`, `devika`.

**Resolve names to IDs.** `clientId` and `projectId` are Firestore doc IDs, not
names. Cache `GET /clients` and `GET /projects` at startup.

**Dates are day-first `en-IN` in the UI but ISO `YYYY-MM-DD` over the wire.**
Use local-date keys, never `toISOString().split()` — that rolls back a day for
IST between 00:00 and 05:29.

---

## Side effects to be aware of

These endpoints are not inert. Writes fan out:

- Writing a task fires `onTaskWritten`, which can **post to Slack** and notify
  the OpenClaw/Asty webhook.
- Writing a leave fires `onLeaveWritten`, which posts to **#leaves**
  (`C09U7GVJ31R`) for `personal`, `medical`, and `overtime` types.

So an agent experimenting against the live API will be visible to the whole
team in Slack. There is no staging environment — treat every write as
production.

---

## Security notes

- `CLAUDE_API_KEY` is a **single shared key with full read/write and no
  per-caller audit trail**. Any holder can delete any task. It is also used by
  Asty's `openclaw-pkwork` plugin, so rotating it means updating
  `openclaw.json` on the VM as well.
- `POKE_MCP_KEY` is separate and independently revocable — another reason to
  prefer Option A for third-party agents.
- Do not hand out Firebase service-account credentials or Asty's Slack tokens.
  Neither is needed for data access.
- The agent needs no repo access unless it is writing code for this project.
