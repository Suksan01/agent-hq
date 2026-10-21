// Page approvals, the pure part: when an ask may be held, the request the helper reads, what its answer means.
// Pure: hooks/pageapproval.ts.
import { expect, test } from 'claude-code/testing'

import { APPROVAL_MS, INPUT_MAX_BYTES, answerOf, approvalRequest, canHold, isShowable } from '../hooks/pageapproval'
import type { HoldFacts } from '../hooks/pageapproval'

const FACTS: HoldFacts = { decision: 'ask', isOn: true, pages: 1, toolUseId: 'u1', tool: 'Bash', mode: 'default', input: { command: 'rm -rf build' } }

test('held only when every condition holds', () => {
  expect(canHold(FACTS)).toBe(true)
  expect(canHold({ ...FACTS, mode: 'acceptEdits' })).toBe(true)
  const refused: Partial<HoldFacts>[] = [
    { decision: 'allow' },
    { decision: 'deny' },
    { isOn: false },
    { pages: 0 },
    { toolUseId: undefined },
    { toolUseId: '' },
    { tool: 'AskUserQuestion' },
    { tool: 'ExitPlanMode' },
    { ceiling: 'ask' },
    { mode: undefined },
    { mode: 'auto' },
    { mode: 'plan' },
    { mode: 'dontAsk' },
    { mode: 'bypassPermissions' },
    { input: { command: 'curl -H "Authorization: Bearer abcdef123456"' } },
    { input: { content: 'x'.repeat(INPUT_MAX_BYTES + 1) } },
  ]
  for (const change of refused) expect([change, canHold({ ...FACTS, ...change })]).toEqual([change, false])
})

test('an input is showable when it has no secret and its JSON is at most 20 KB of UTF-8', () => {
  expect(isShowable({ command: 'ls' })).toBe(true)
  expect(isShowable({ command: 'export API_KEY=abc123def' })).toBe(false)
  const fits = 'x'.repeat(INPUT_MAX_BYTES - JSON.stringify({ c: '' }).length)
  expect(isShowable({ c: fits })).toBe(true)
  expect(isShowable({ c: `${fits}x` })).toBe(false)
  // Thai is 3 bytes a character in UTF-8: a third as many characters fill the same 20 KB
  expect(isShowable({ c: 'ก'.repeat(Math.ceil(INPUT_MAX_BYTES / 3)) })).toBe(false)
  expect(isShowable(undefined)).toBe(false)
  const loop: Record<string, unknown> = {}
  loop.self = loop
  expect(isShowable(loop)).toBe(false)
})

test("the helper's answer is its first line: allow, deny or ask; anything else is none", () => {
  expect(answerOf('allow\n')).toBe('allow')
  expect(answerOf(' deny \nextra')).toBe('deny')
  expect(answerOf('ask')).toBe('ask')
  expect(answerOf('')).toBeNull()
  expect(answerOf('ALLOW')).toBeNull()
  expect(answerOf('allowed')).toBeNull()
  expect(answerOf('\nallow')).toBeNull()
})

test('the request names the call, who made it, the full input and the wait', () => {
  const sent = JSON.parse(approvalRequest({ id: 'u1', agent: 'Mochi (dev-1)', role: 'Developer', tool: 'Bash', input: { command: 'ls' }, cwd: '/work/app', lang: 'th', at: 7 }))
  expect(sent).toEqual({ id: 'u1', agent: 'Mochi (dev-1)', role: 'Developer', tool: 'Bash', input: { command: 'ls' }, cwd: '/work/app', lang: 'th', at: 7, timeoutMs: APPROVAL_MS })
})
