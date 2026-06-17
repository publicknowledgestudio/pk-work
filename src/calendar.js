// Google Calendar integration — client-side via REST API
// Uses an OAuth access token for the calendar.events.readonly scope.
//
// Token lifecycle:
// - Acquired silently on load via Google Identity Services (GIS) when possible,
//   or via an interactive consent popup the first time (or if the Google session
//   is gone). See ensureCalendarToken().
// - Cached in localStorage WITH its expiry, so it survives refreshes, tab
//   closes, and browser restarts until it actually expires (~1hr).
// - On expiry (or a 401) we silently mint a fresh one via GIS — no popup —
//   as long as the user has an active Google session and previously consented.
// - Falls back to the Firebase sign-in popup (see main.js) when no GIS client
//   id is configured.

import { googleOAuthClientId } from './config.js'
import { isDemo, demo } from './demo.js'

const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
const STORAGE_KEY = 'pk_gcal_token'
const EXPIRY_KEY = 'pk_gcal_token_exp'

let accessToken = null
let tokenExpiry = 0 // epoch ms; 0 = unknown/none

// Restore a still-valid token from a previous session.
try {
  accessToken = localStorage.getItem(STORAGE_KEY) || null
  tokenExpiry = Number(localStorage.getItem(EXPIRY_KEY) || 0)
  if (accessToken && tokenExpiry && Date.now() >= tokenExpiry) {
    accessToken = null
    tokenExpiry = 0
  }
} catch (_) {
  // Storage may be blocked in cross-origin contexts
}

export function setAccessToken(token, expiresInSec) {
  accessToken = token || null
  // GIS gives expires_in (seconds); Firebase popup doesn't, so assume ~55 min.
  // Subtract a 60s safety margin so we refresh before the API starts 401ing.
  tokenExpiry = token
    ? Date.now() + ((expiresInSec ? expiresInSec - 60 : 55 * 60) * 1000)
    : 0
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token)
      localStorage.setItem(EXPIRY_KEY, String(tokenExpiry))
    } else {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(EXPIRY_KEY)
    }
  } catch (_) {
    // Storage may be blocked
  }
}

export function getAccessToken() {
  if (accessToken && tokenExpiry && Date.now() >= tokenExpiry) {
    clearAccessToken()
    return null
  }
  return accessToken
}

export function clearAccessToken() {
  accessToken = null
  tokenExpiry = 0
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(EXPIRY_KEY)
  } catch (_) {
    // Storage may be blocked
  }
}

// ── Google Identity Services (silent token refresh) ──

let gisLoading = null
let tokenClient = null
let resolvePending = null

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisLoading) return gisLoading
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => { gisLoading = null; reject(new Error('Failed to load Google Identity Services')) }
    document.head.appendChild(s)
  })
  return gisLoading
}

async function getTokenClient() {
  await loadGis()
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: googleOAuthClientId,
      scope: CAL_SCOPE,
      callback: (resp) => {
        if (resp && resp.access_token) {
          setAccessToken(resp.access_token, resp.expires_in)
          resolvePending?.(resp.access_token)
        } else {
          resolvePending?.(null)
        }
        resolvePending = null
      },
      error_callback: () => { resolvePending?.(null); resolvePending = null },
    })
  }
  return tokenClient
}

// Ensure we have a usable calendar token.
// - interactive=false: silent (prompt:'none') — no popup, fails quietly if the
//   user needs to consent or has no Google session. Safe to call on load.
// - interactive=true: shows the consent/account UI. Must be called from a click.
// Returns the token, or null if unavailable. Returns null (so callers can fall
// back to the Firebase popup) when no GIS client id is configured.
export async function ensureCalendarToken({ interactive = false, hint } = {}) {
  const existing = getAccessToken()
  if (existing) return existing
  if (!googleOAuthClientId) return null
  try {
    const client = await getTokenClient()
    return await new Promise((resolve) => {
      resolvePending = resolve
      const opts = { prompt: interactive ? '' : 'none' }
      if (hint) opts.hint = hint
      client.requestAccessToken(opts)
    })
  } catch (_) {
    resolvePending = null
    return null
  }
}

// Fetch a day's calendar events for the signed-in user.
export async function loadCalendarEvents(dateStr) {
  if (isDemo()) return demo.loadCalendarEvents(dateStr)
  if (!getAccessToken()) return { events: [], needsAuth: true }

  const dayStart = new Date(dateStr + 'T00:00:00')
  const dayEnd = new Date(dateStr + 'T23:59:59')

  const params = new URLSearchParams({
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  })

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${getAccessToken()}` } }
    )

    if (res.status === 401 || res.status === 403) {
      const body = await res.json().catch(() => ({}))
      console.warn('Calendar API auth error:', res.status, body?.error?.message || '')
      clearAccessToken()
      return { events: [], needsAuth: true }
    }

    if (!res.ok) return { events: [], needsAuth: false }

    const data = await res.json()
    return { events: parseEvents(data.items || []), needsAuth: false }
  } catch (err) {
    console.warn('Calendar fetch error:', err)
    return { events: [], needsAuth: false }
  }
}

function parseEvents(items) {
  return items
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      id: e.id,
      summary: e.summary || '(No title)',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      allDay: !e.start?.dateTime,
      hangoutLink: e.hangoutLink || e.conferenceData?.entryPoints?.[0]?.uri || '',
      htmlLink: e.htmlLink || '',
      location: e.location || '',
      attendees: (e.attendees || []).length,
    }))
}
