/**
 * Pure validation for task comments and capture metadata. Asterisk's intake
 * service writes both through the REST API, so bad input must be a 400 here.
 */

const MAX_COMMENT_LENGTH = 10000

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Where a task came from. Returns null when no source was given.
function normalizeSource(source) {
  if (source === undefined || source === null) return null
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('source must be an object')
  }
  const type = cleanString(source.type)
  if (!type) throw new Error('source.type is required')
  return {
    type,
    url: cleanString(source.url),
    channelId: cleanString(source.channelId),
    messageTs: cleanString(source.messageTs),
  }
}

// How Asterisk captured a task. Returns null when not captured.
function normalizeCapture(capture) {
  if (capture === undefined || capture === null) return null
  if (typeof capture !== 'object' || Array.isArray(capture)) {
    throw new Error('capture must be an object')
  }
  const captureId = cleanString(capture.captureId)
  if (!captureId) throw new Error('capture.captureId is required')
  return { captureId, reasoning: cleanString(capture.reasoning) }
}

function normalizeComment(data) {
  const body = data || {}
  const text = cleanString(body.text)
  if (!text) throw new Error('text is required')
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new Error(`text must be ${MAX_COMMENT_LENGTH} characters or fewer`)
  }
  const author = cleanString(body.author)
  if (!author) throw new Error('author is required')
  return { text, author, source: normalizeSource(body.source) }
}

module.exports = { normalizeSource, normalizeCapture, normalizeComment, MAX_COMMENT_LENGTH }
