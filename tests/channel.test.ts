// The server's stdout lines as the mod reads them.
import { expect, test } from 'claude-code/testing'

import { lineBuffer, parseChannelLine } from '../hooks/channel'

test('lineBuffer returns whole lines only, across pieces', () => {
  const lines = lineBuffer()
  expect(lines.push('AGENT_HQ_URL http://127.0.0.1:4870/?c=ab')).toEqual([])
  expect(lines.push('cd\nAGENT_HQ_ACTION {"id":1}\nAGENT_HQ_AC')).toEqual(['AGENT_HQ_URL http://127.0.0.1:4870/?c=abcd', 'AGENT_HQ_ACTION {"id":1}'])
  expect(lines.push('TION {"id":2}\r\n')).toEqual(['AGENT_HQ_ACTION {"id":2}'])
  expect(lines.push('')).toEqual([])
})

test('lineBuffer drops a runaway line instead of growing without end', () => {
  const lines = lineBuffer()
  lines.push('x'.repeat(200_000))
  expect(lines.push('\nnext\n')).toEqual([expect.any(String), 'next'])
})

test('parseChannelLine reads the URL line, the open page count and action lines', () => {
  expect(parseChannelLine('AGENT_HQ_URL http://127.0.0.1:4870/?c=abc')).toEqual({ kind: 'url', url: 'http://127.0.0.1:4870/?c=abc' })
  expect(parseChannelLine('AGENT_HQ_PAGES 3')).toEqual({ kind: 'pages', count: 3 })
  expect(parseChannelLine('AGENT_HQ_PAGES 0')).toEqual({ kind: 'pages', count: 0 })
  expect(parseChannelLine('AGENT_HQ_ACTION {"id":7,"type":"lead","text":"hi"}')).toEqual({ kind: 'action', action: { id: 7, type: 'lead', text: 'hi' } })
})

test('parseChannelLine ignores everything else, and actions without a usable id', () => {
  for (const line of [
    '',
    'agent-hq web: session a takes actions on 127.0.0.1:1',
    'AGENT_HQ_URL ',
    'AGENT_HQ_URL two words',
    'AGENT_HQ_PAGES ',
    'AGENT_HQ_PAGES -1',
    'AGENT_HQ_PAGES 1.5',
    'AGENT_HQ_PAGES many',
    'AGENT_HQ_ACTION not json',
    'AGENT_HQ_ACTION null',
    'AGENT_HQ_ACTION []',
    'AGENT_HQ_ACTION {"type":"lead"}',
    'AGENT_HQ_ACTION {"id":"7"}',
    'AGENT_HQ_ACTION {"id":0}',
    'AGENT_HQ_ACTION {"id":1.5}',
    'AGENT_HQ_ACTION {"id":-2}',
    ' AGENT_HQ_ACTION {"id":1}',
  ]) {
    expect(parseChannelLine(line)).toBeNull()
  }
})
