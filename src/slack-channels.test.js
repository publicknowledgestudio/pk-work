import { describe, it, expect } from 'vitest'
import { parseChannelRef } from './slack-channels.js'

describe('parseChannelRef', () => {
  it('accepts a bare channel ID', () => {
    expect(parseChannelRef(' C08UCQXH7D0 ')).toBe('C08UCQXH7D0')
    expect(parseChannelRef('G01ABCDEFGH')).toBe('G01ABCDEFGH')
  })

  it('extracts the ID from Slack links', () => {
    expect(parseChannelRef('https://pk.slack.com/archives/C08UCQXH7D0')).toBe('C08UCQXH7D0')
    expect(parseChannelRef('https://pk.slack.com/archives/C08UCQXH7D0/p1700000000000100')).toBe('C08UCQXH7D0')
    expect(parseChannelRef('https://app.slack.com/client/T012345/C08UCQXH7D0')).toBe('C08UCQXH7D0')
  })

  it('returns null for names and junk', () => {
    expect(parseChannelRef('brunk')).toBeNull()
    expect(parseChannelRef('#brunk')).toBeNull()
    expect(parseChannelRef('')).toBeNull()
    expect(parseChannelRef('c08ucqxh7d0')).toBeNull()
  })
})
