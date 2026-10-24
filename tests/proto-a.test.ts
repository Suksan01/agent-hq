// Prototype only, variant A (docs/specs/task-sidebar.md, phase 3): the Ledger table fits every sidebar width. Removed in phase 6.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { textWidth } from '../hooks/cells'

const PANE_PROPS = (cols: number) => ({ title: 'Agent HQ', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} })

async function mountA($: Engine, on: On, proto: string, cols: number) {
  mock.clock(on)
  on('env.get', (_, e) => ({ value: e.name === 'AGENT_HQ_PROTO' ? proto : undefined }) as never)
  on('agent.list', () => ({ value: [] }))
  return $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS(cols) as never })
}
async function linesAt($: Engine, on: On, proto: string, cols: number) {
  const ui = await mountA($, on, proto, cols)
  const lines = (await ui.findAll({ type: 'Box' })).filter(r => r.key?.startsWith('a-row-')).map(r => r.text ?? '')
  await ui.unmount()
  return lines
}

for (const proto of ['a', 'a:many']) {
  for (const cols of [40, 60, 100]) {
    test(`variant A (${proto}) rows are no wider than ${cols} columns, Min and the cost whole`, async ($, on) => {
      const lines = await linesAt($, on, proto, cols)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(cols)
      expect(lines.find(l => l.includes('Sidebar'))).toMatch(/12\s+0\.38\+$/)
      if (cols === 40) expect(lines.find(l => l.includes('Sidebar'))).toContain('…')
    })
  }
}

test('many tasks show "+N more" and always the total row', async ($, on) => {
  const lines = await linesAt($, on, 'a:many', 60)
  expect(lines.some(l => /^\+\d+ more$/.test(l))).toBe(true)
  expect(lines.at(-1)).toMatch(/^Total 8\/28/)
})

test('an empty plan says so in one line', async ($, on) => {
  expect(await linesAt($, on, 'a:empty', 60)).toEqual(['The plan has no tasks yet.'])
})
