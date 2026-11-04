/**
 * Scheduling a task onto someone's day, shared by the HTTP API and the PK Work
 * Slack buttons.
 *
 * This lives in its own module so "On it today" in Slack and a drag in the web
 * app cannot drift apart. Both call `applySchedule`; the HTTP route is a thin
 * wrapper that turns its result into a response.
 */

function dailyFocusId(userEmail, date) {
  return `${userEmail}_${date}`
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * Resolve which person's day we are writing to.
 *
 * The task's assignee always wins, regardless of who triggered the schedule —
 * clicking "On it today" on someone else's task puts it on THEIR day, not
 * yours. Only when a task has no assignee do we fall back to the requester,
 * and in that case the requester claims it (the task is assigned to them).
 */
async function resolveScheduleUser({ body, taskData, resolveAssignees }) {
  const assignees = (taskData && taskData.assignees) || []
  if (assignees[0]) return { userEmail: assignees[0], claimed: false }

  if (body.userEmail) return { userEmail: body.userEmail, claimed: true }
  if (body.person) {
    const resolved = await resolveAssignees([body.person])
    if (resolved[0]) return { userEmail: resolved[0], claimed: true }
  }
  return { userEmail: null, claimed: false }
}

/**
 * Put `taskId` on `date` for the resolved person.
 *
 * Returns `{ ok: false, status, error }` rather than throwing, so both callers
 * can report the failure in their own idiom.
 */
async function applySchedule({ db, admin, resolveAssignees, taskId, date, person, userEmail }) {
  if (!taskId) return { ok: false, status: 400, error: 'taskId is required' }
  if (!isIsoDate(date)) {
    return { ok: false, status: 400, error: 'date is required as YYYY-MM-DD' }
  }

  // Verify the task exists first — scheduling an unknown id would otherwise
  // create a dailyFocus entry pointing at nothing.
  const taskSnap = await db.collection('tasks').doc(taskId).get()
  if (!taskSnap.exists) {
    return { ok: false, status: 404, error: `Unknown task: ${taskId}` }
  }

  const resolved = await resolveScheduleUser({
    body: { person, userEmail },
    taskData: taskSnap.data(),
    resolveAssignees,
  })
  if (!resolved.userEmail) {
    return {
      ok: false,
      status: 400,
      error: 'No person to schedule for: task is unassigned and no person/userEmail was given',
    }
  }

  // An unassigned task scheduled by someone is thereby claimed by them, so the
  // day it lands on and the task's owner stay consistent.
  if (resolved.claimed) {
    await db.collection('tasks').doc(taskId).update({
      assignees: [resolved.userEmail],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  const targetId = dailyFocusId(resolved.userEmail, date)
  const batch = db.batch()

  // A task occupies one day per person, so clear it from that person's other
  // days first — same move semantics as dragging between days in the web app.
  const existing = await db
    .collection('dailyFocus')
    .where('taskIds', 'array-contains', taskId)
    .get()
  for (const d of existing.docs) {
    if (d.data().userEmail !== resolved.userEmail) continue
    if (d.id === targetId) continue
    batch.update(d.ref, {
      taskIds: admin.firestore.FieldValue.arrayRemove(taskId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  batch.set(
    db.collection('dailyFocus').doc(targetId),
    {
      userEmail: resolved.userEmail,
      date,
      taskIds: admin.firestore.FieldValue.arrayUnion(taskId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  )

  await batch.commit()

  return {
    ok: true,
    taskId,
    userEmail: resolved.userEmail,
    date,
    claimed: resolved.claimed,
    title: taskSnap.data().title || null,
  }
}

module.exports = { applySchedule, resolveScheduleUser, dailyFocusId, isIsoDate }
