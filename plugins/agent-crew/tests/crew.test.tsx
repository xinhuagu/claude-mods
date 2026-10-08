import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = { title: 'Agent Crew', isFocused: false, bodyColumns: 70, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

test('the crew shows up, works and clocks out on every surface', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  let n = 0
  const spawn = (description: string, subagentType: string) =>
    $.agent.spawn({
      tool_use_id: `tu-${description}`,
      prompt: description,
      description,
      subagentType,
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: `agent-${++n}` }))
  const opened: string[] = []
  on('ui.open', async (_$, e) => (opened.push(e.id), { value: { isPlaced: true as const } }))
  on('turn.complete', async () => ({ text: '' }))

  await spawn('Research competitor launches', 'Explore')
  await spawn('Build the landing page', 'general-purpose')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-crew', surface, component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
    expect(await ui.find({ text: /Build the landing page/ })).toBeDefined()
    expect(await ui.find({ text: /scout/ })).toBeDefined()
    expect(await ui.find({ text: /2 working/ })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({ agentId: 'agent-1', answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await ui.find({ text: /1 working/ })).toBeDefined()
  await ui.press({ key: 'clear' })
  expect(await ui.find({ text: /Research competitor launches/ })).toBeUndefined()
  expect(await ui.find({ text: /Build the landing page/ })).toBeDefined()
})

test('the pane closes itself a while after the last agent clocks out, unless a new one starts', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let n = 0
  const spawn = (description: string) =>
    $.agent.spawn({
      tool_use_id: `tu-${description}`,
      prompt: description,
      description,
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
  const finish = (agentId: string) =>
    $.turn.complete({ agentId, answer: 'done', durationMs: 1000, isAborted: false, turnId: `t-${agentId}`, reason: 'answer' })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: `agent-${++n}` }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  const closed: string[] = []
  on('ui.close', async (_$, e) => (closed.push(e.id), { value: undefined }))
  on('turn.complete', async () => ({ text: '' }))

  await spawn('First job')
  await finish('agent-1')
  await clock.advance(5_000)
  await spawn('Second job')
  await clock.advance(10_000)
  expect(closed).toEqual([])

  await finish('agent-2')
  await clock.advance(9_000)
  expect(closed).toEqual([])
  await clock.advance(2_000)
  expect(closed).toEqual(['agent-crew'])
})
