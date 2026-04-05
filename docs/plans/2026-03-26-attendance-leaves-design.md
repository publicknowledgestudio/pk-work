# Attendance & Leave Management

**Date:** 2026-03-26
**Approach:** Standalone Attendance Module (Approach A — new Firestore collection, API endpoints, frontend view)

## Overview

Leave tracking + balance management for the PK studio team. Replaces the current Slack-only workflow (#leaves channel) with structured data in PK Work. Leaves are optimistic — auto-approved, admin can cancel.

## Data Model

### TEAM config change (`src/config.js`)

Add `role` and `joinDate` to each team member:

```js
{ email: 'gyan@publicknowledge.co', name: 'Gyan', color: '#4f46e5', role: 'admin', joinDate: '2024-01-01' },
{ email: 'charu@publicknowledge.co', name: 'Charu', color: '#0891b2', role: 'admin', joinDate: '2024-01-01' },
{ email: 'sharang@publicknowledge.co', name: 'Sharang', color: '#c026d3', role: 'member', joinDate: '...' },
{ email: 'anandu@publicknowledge.co', name: 'Anandu', color: '#ea580c', role: 'member', joinDate: '...' },
{ email: 'mohit@publicknowledge.co', name: 'Mohit', color: '#059669', role: 'member', joinDate: '...' },
```

Asty excluded from attendance.

### New collection: `leaves`

Each document is one leave request:

| Field | Type | Description |
|-------|------|-------------|
| `userEmail` | string | Who's taking leave |
| `userName` | string | Display name |
| `type` | string | `"personal"` or `"medical"` |
| `startDate` | string | `"2026-03-27"` (YYYY-MM-DD) |
| `endDate` | string | Same as startDate for single day |
| `halfDay` | boolean | If true, counts as 0.5 days |
| `paidDays` | number | Computed: days covered by balance |
| `unpaidDays` | number | Computed: days exceeding balance (personal only) |
| `status` | string | `"approved"` (default) or `"cancelled"` |
| `cancelledBy` | string \| null | Admin email if cancelled |
| `cancelledAt` | timestamp \| null | When cancelled |
| `note` | string | Optional reason |
| `createdAt` | timestamp | When requested |
| `createdBy` | string | Email of who logged it |

### Accrual rules

- **Rate:** 1 personal + 1 medical per completed calendar month from `joinDate`
- **Balance:** accrued − used (count of approved leave days of that type)
- **No cap** on rollover
- **Medical leave** never goes unpaid — if you're sick, you're sick
- **Personal leave** auto-calculates paid vs unpaid: if balance < days requested, shortfall = unpaid
- **Half day** = 0.5 deduction from the chosen type

### Firestore indexes

| Collection | Fields | Purpose |
|------------|--------|---------|
| `leaves` | `userEmail` ASC + `startDate` DESC | Filter leaves by person |
| `leaves` | `status` ASC + `startDate` DESC | Filter active leaves |

## API Endpoints

All on existing `api` function, same `x-api-key` auth.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/leaves` | List leaves. Filters: `?userEmail=&status=approved&startDate=2026-01-01&endDate=2026-03-31` |
| `POST` | `/leaves` | Create leave request. Auto-calculates paid vs unpaid from balance. |
| `PATCH` | `/leaves/:id` | Cancel a leave (admin only — sets `status: "cancelled"`) |
| `GET` | `/leaves/balances` | Get balances for all team (or `?userEmail=` for one). Returns accrued, used, unpaid per type. |

### POST `/leaves` body

```json
{
  "userEmail": "sharang@publicknowledge.co",
  "userName": "Sharang",
  "type": "personal",
  "startDate": "2026-04-01",
  "endDate": "2026-04-02",
  "halfDay": false,
  "note": "Family thing",
  "createdBy": "sharang@publicknowledge.co"
}
```

### GET `/leaves/balances` response

```json
[
  {
    "userEmail": "sharang@publicknowledge.co",
    "userName": "Sharang",
    "joinDate": "2025-06-01",
    "personal": { "accrued": 10, "used": 5, "unpaid": 1, "available": 5 },
    "medical": { "accrued": 10, "used": 2, "available": 8 }
  }
]
```

## Frontend

### Route

`#/attendance` — new nav tab between Timesheets and People.

### Layout

Two sections:

**Top: Balance Cards** — one per team member (admins see all, members see own)

```
┌─────────────────────────────────────┐
│  👤 Sharang                         │
│  Personal: ●●●●●○○○  5/8 used      │
│  Medical:  ●○○○○○○○  1/8 available  │
│  [Request Leave]                    │
└─────────────────────────────────────┘
```

**Bottom: Month Calendar Grid** — rows = people, columns = days

```
Mar 2026     1    2    3    4    5    6    7  ...
Gyan         🟢        🟢   🟢   🟢        🟢
Charu        🟢        🔴   🔴   🟢        🟢
Sharang      🟢        🟢   🟡   🟢        🟢
Anandu       🟢        🟢   🟢   🟢        🟢
```

- Weekends: greyed out columns, no dot
- 🟢 Green dot: present (no leave — default)
- 🔴 Red dot: medical leave or personal leave
- 🟡 Yellow dot: half day
- Click a dot to see leave details
- Month picker to navigate forward/back

### Status legend

| ID | Label | Dot color |
|----|-------|-----------|
| `wfo` | Working from Office | 🟢 green |
| `wfh` | Working from Home | 🟢 green |
| `half_day` | Half Day | 🟡 yellow |
| `medical_leave` | Medical Leave | 🔴 red |
| `personal_leave` | Personal Leave | 🔴 red |
| `unpaid_leave` | Unpaid Leave | 🔴 red |

Note: v1 only tracks leaves. WFO/WFH distinction is not persisted — everyone without a leave is assumed present. Can add daily status later.

### Request Leave Modal

Fields:
- **Type:** Personal / Medical (toggle buttons)
- **Date range:** Start + End (defaults to same day for single)
- **Half day:** checkbox
- **Note:** optional text

On submit, shows confirmation: "This will use 2 personal leave days (1 paid, 1 unpaid)" before saving.

### Permissions

- Members see their own balance card + full team calendar grid
- Admins (Gyan, Charu) see all balance cards + can cancel leaves + can request leaves on behalf of others
- Admin determined by `role: 'admin'` in TEAM config

## Asty Integration (future)

3 new openclaw-pkwork tools:
- `pkwork_request_leave` — POST `/leaves`
- `pkwork_list_leaves` — GET `/leaves`
- `pkwork_leave_balances` — GET `/leaves/balances`

When someone posts in #leaves, Asty creates the leave via API and DMs them a link to confirm in the web app.

## Files to create/modify

- `src/config.js` — add `role`, `joinDate` to TEAM
- `src/attendance.js` — new frontend module
- `src/leave-modal.js` — leave request modal
- `src/main.js` — add route, nav tab, imports
- `src/style.css` — attendance styles
- `src/db.js` — Firestore queries for leaves
- `functions/index.js` — API endpoints
- `firestore.indexes.json` — new composite indexes
- `firestore.rules` — leave read/write rules
