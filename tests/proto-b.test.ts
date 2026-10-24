// Prototype only, variant B (docs/specs/task-sidebar.md, phase 3): the sidebar task table fits every sidebar width. Removed in phase 6.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { textWidth } from '../hooks/cells'

const PANE_PROPS = (cols: number) => ({ title: 'Agent HQ', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} })

async function mountB($: Engine, on: On, proto: string, cols: number) {
  mock.clock(on)
  on('env.get', (_, e) => ({ value: e.name === 'AGENT_HQ_PROTO' ? proto : undefined }) as never)
  on('agent.list', () => ({ value: [] }))
  return $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS(cols) as never })
}

for (const cols of [40, 60, 100]) {
  test(`variant B rows are no wider than ${cols} columns, with Min and the cost whole`, async ($, on) => {
    const ui = await mountB($, on, 'b', cols)
    const rows = (await Promise.all([3, 4].map(n => ui.find({ key: `b-row-${n}` })))).filter(r => r !== undefined)
    expect(rows.length).toBeGreaterThan(0)
    const text = rows.map(r => r.text ?? '')
    for (const line of text) expect(textWidth(line)).toBeLessThanOrEqual(cols)
    expect(text.join('\n')).toMatch(/0\.38/) // the cost column is never cut
    await ui.unmount()
  })
}

for (const cols of [40, 60, 100]) {
  test(`the folded lines and the total row fit ${cols} columns`, async ($, on) => {
    const ui = await mountB($, on, 'b', cols)
    for (const key of ['b-fold-done', 'b-fold-waiting']) expect(textWidth((await ui.find({ key }))?.text ?? '')).toBeLessThanOrEqual(cols)
    const total = await ui.find({ type: 'Text', text: /Total 2\/7/ })
    expect(textWidth(total?.text ?? '')).toBeLessThanOrEqual(cols)
    await ui.unmount()
  })
}

test('many tasks show Now rows first, then "+N more", and the total', async ($, on) => {
  const ui = await mountB($, on, 'b:many', 60)
  expect(await ui.find({ text: /\+2 more/ })).toBeDefined()
  expect(await ui.find({ text: /Total 8\/28/ })).toBeDefined()
  await ui.unmount()
})

test('an empty plan says so in one line', async ($, on) => {
  const ui = await mountB($, on, 'b:empty', 60)
  expect(await ui.find({ text: /The plan has no tasks yet/ })).toBeDefined()
  expect(await ui.find({ key: 'b-row-1' })).toBeUndefined()
  await ui.unmount()
})

test('the Done line keeps the cost with its estimate sign when it fits', async ($, on) => {
  const ui = await mountB($, on, 'b', 60)
  expect((await ui.find({ key: 'b-fold-done' }))?.text).toMatch(/Done 2 · 19 min · ≈ \$0\.59$/)
  await ui.unmount()
})
