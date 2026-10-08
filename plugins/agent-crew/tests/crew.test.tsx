import { expect, mock, test } from 'claude-code/testing'

import { addressee, bar, grey, lane, progress, sprite, SPRITE_WIDTH } from '../hooks/register'
import type { CrewMember } from '../types'

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

test('a letter flies between teammates, the sender talks and the receiver perks up', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let n = 0
  const spawn = (description: string, name: string) =>
    $.agent.spawn({
      tool_use_id: `tu-${name}`,
      prompt: description,
      description,
      subagentType: 'teammate',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
      isTeammate: true,
      name,
    })
  on('agent.spawn', async (_$, e) => ({ model: 'claude-opus-5-5', agentId: `agent-${++n}`, teammateId: `${e.name}@crew` }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.send', async () => ({ isDelivered: true as const }))

  await spawn('Map the auth module', 'scout')
  await spawn('Implement refresh endpoint', 'builder')
  await $.session.send({ to: 'builder', text: 'found 3 call sites in auth/\nmore later', origin: { kind: 'model' }, agentId: 'agent-1' })

  const ui = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await ui.find({ text: /💬 → builder: "found 3 call sites in auth\/"/ })).toBeDefined()
  expect(await ui.find({ text: /⌂/ })).toBeDefined()
  expect(await ui.find({ text: /💌 1/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(2_100)
  const later = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await later.find({ text: /📬 from scout: "found 3 call sites in auth\/"/ })).toBeDefined()
  expect(await later.find({ text: /✉1↑0↓/ })).toBeDefined()
  expect(await later.find({ text: /✉0↑1↓/ })).toBeDefined()
})

test('a finished agent mails its report home to the lead', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let n = 0
  const spawn = (description: string, name: string) =>
    $.agent.spawn({
      tool_use_id: `tu-${name}`, prompt: description, description, subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false, name,
    })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: `agent-${++n}` }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('turn.complete', async () => ({ text: '' }))

  await spawn('Shanghai weather', 'weather')
  await spawn('Shanghai travel tips', 'travel')
  await $.turn.complete({ agentId: 'agent-1', answer: '# 上海天气预报\n逐日表…', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await ui.find({ text: /💬 → lead: "# 上海天气预报"/ })).toBeDefined()
  expect(await ui.find({ text: /⌂/ })).toBeDefined()
  expect(await ui.find({ text: /💌 1/ })).toBeDefined()
  expect(await ui.find({ text: /✉1↑0↓/ })).toBeDefined()
  expect(await ui.find({ text: /1 working/ })).toBeDefined()
  await ui.unmount()

  // A run that was stopped or failed hands nothing back, so it sends no letter.
  await $.turn.complete({ agentId: 'agent-2', answer: '', durationMs: 1000, isAborted: true, turnId: 't2', reason: 'aborted' })
  await clock.advance(5_000)
  const later = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await later.find({ text: /💌 1/ })).toBeDefined()
})

test('a background subagent writing to main lands at the lead', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'agent-1' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.send', async () => ({ isDelivered: true as const }))
  await $.agent.spawn({
    tool_use_id: 'tu-1', prompt: 'x', description: 'Background job', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  await $.session.send({ to: 'main', text: 'halfway there', origin: { kind: 'model' }, agentId: 'agent-1' })

  const ui = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await ui.find({ text: /💬 → lead: "halfway there"/ })).toBeDefined()
  expect(await ui.find({ text: /💌 1/ })).toBeDefined()
})

test('mail to someone outside the crew leaves the pane alone', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: 'agent-1' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.send', async () => ({ isDelivered: true as const }))
  await $.agent.spawn({
    tool_use_id: 'tu-1', prompt: 'x', description: 'Solo job', subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
  })
  await $.session.send({ to: 'some-other-session', text: 'hi', origin: { kind: 'model' } })

  const ui = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await ui.find({ text: /💌/ })).toBeUndefined()
  expect(await ui.find({ text: /⌂/ })).toBeUndefined()
})

test('the lane draws a bracket from sender to receiver in the sender color', () => {
  const member = (id: string, look: number) => ({ id, task: id, type: 'teammate', model: 'm', startedAt: 0, steps: 0, tokens: 0, status: 'working' as const, look, sent: 0, received: 0 })
  const list = [member('a', 0), member('b', 1), member('c', 2)]
  const row = (cells: { char: string }[]) => cells.map(c => c.char).join('')

  const landed = lane(list, [{ id: 1, from: 'c', to: 'a', sentAt: 0 }], 4_000)
  expect(row(landed[2]!)).toBe('╭──▶')
  expect(row(landed[10]!)).toBe('╰───')
  expect(row(landed[6]!)).toBe('│   ')
  expect(landed[6]![0]!.isFaded).toBe(true)
  expect(landed[6]![0]!.color).toBe('#E07A9A')

  const crossing = lane(list, [{ id: 1, from: 'a', to: 'c', sentAt: 0 }, { id: 2, from: 'lead', to: 'b', sentAt: 100 }], 1_000)
  expect(row(crossing[0]!)).toBe('⌂─┐ ')
  expect(row(crossing[6]!)).toBe('✉ ╰▶')
})

test('a new batch after the crew clocked out starts with a fresh crew', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  let n = 0
  const spawn = (description: string) =>
    $.agent.spawn({
      tool_use_id: `tu-${description}`, prompt: description, description, subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
    })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: `agent-${++n}` }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('turn.complete', async () => ({ text: '' }))

  await spawn('Old job one')
  await spawn('Old job two')
  await $.turn.complete({ agentId: 'agent-1', answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await spawn('Joins while one still works')
  await $.turn.complete({ agentId: 'agent-2', answer: 'done', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
  await $.turn.complete({ agentId: 'agent-3', answer: 'done', durationMs: 1000, isAborted: false, turnId: 't3', reason: 'answer' })
  await spawn('New batch')

  const ui = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await ui.find({ text: /New batch/ })).toBeDefined()
  expect(await ui.find({ text: /Old job one/ })).toBeUndefined()
  expect(await ui.find({ text: /Joins while one still works/ })).toBeUndefined()
})

test('agents spawned in parallel all join the crew', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  let n = 0
  const spawn = (description: string) =>
    $.agent.spawn({
      tool_use_id: `tu-${description}`, prompt: description, description, subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
    })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: `agent-${++n}` }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))

  await Promise.all([spawn('Shanghai news'), spawn('Shanghai weather'), spawn('Shanghai travel tips')])

  const ui = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await ui.find({ text: /Shanghai news/ })).toBeDefined()
  expect(await ui.find({ text: /Shanghai weather/ })).toBeDefined()
  expect(await ui.find({ text: /Shanghai travel tips/ })).toBeDefined()
  expect(await ui.find({ text: /3 working/ })).toBeDefined()
})

const member = (over: Partial<CrewMember>): CrewMember => ({
  id: 'agent-1', task: 'task', type: 'general-purpose', model: 'claude-opus-5-5', startedAt: 0,
  steps: 0, tokens: 0, status: 'working', look: 0, sent: 0, received: 0, ...over,
})

test('mail finds its addressee by id, name, name@team, or the lead', () => {
  const list = [member({ id: 'a1', name: 'mapper' }), member({ id: 'a2' })]
  expect(addressee(list, 'a1')).toBe('a1')
  expect(addressee(list, 'a2')).toBe('a2')
  expect(addressee(list, 'mapper')).toBe('a1')
  expect(addressee(list, 'mapper@crew')).toBe('a1')
  expect(addressee(list, 'team-lead')).toBe('lead')
  expect(addressee(list, 'lead@crew')).toBe('lead')
  expect(addressee(list, 'main')).toBe('lead')
  expect(addressee(list, 'stranger')).toBeUndefined()
})

test('progress creeps toward 95% while working and fills once finished', () => {
  expect(progress(member({ steps: 0 }))).toBe(0)
  expect(progress(member({ steps: 6 }))).toBe(0.5)
  expect(progress(member({ steps: 10_000 }))).toBe(0.95)
  for (const status of ['done', 'failed', 'stopped'] as const) expect(progress(member({ status }))).toBe(1)
})

test('the bar always fills its width', () => {
  expect(bar(0.5, 10)).toEqual({ filled: '█████', empty: '░░░░░' })
  expect(bar(0, 4)).toEqual({ filled: '', empty: '░░░░' })
  expect(bar(1, 4)).toEqual({ filled: '████', empty: '' })
  expect(bar(0.5, 0)).toEqual({ filled: '█', empty: '' })
})

test('every Clawd row fills the sprite column in every state and pose', () => {
  const moods = [undefined, { kind: 'talk' as const }, { kind: 'listen' as const }]
  for (const status of ['working', 'done', 'failed', 'stopped'] as const)
    for (const kind of moods)
      for (let look = 0; look < 36; look++)
        for (let tick = 0; tick < 4; tick++) {
          const mood = kind && { ...kind, peer: 'p', ink: '#fff', text: 't', since: 0, until: 10 }
          for (const row of sprite(member({ status, look, mood }), tick, 5))
            expect([...row.map(([text]) => text).join('')].length).toBe(SPRITE_WIDTH)
        }
})

test('the first Clawd is Clawd orange and bareheaded, and failed Clawds go grey', () => {
  const first = sprite(member({ look: 0 }), 0, 0)
  expect(first).toHaveLength(2)
  expect(first[1]![1]).toEqual(['▀▜▀▛', '#D77757'])
  expect(first[0]!.some(([, , bg]) => bg !== undefined)).toBe(false)
  expect(first[0]![2]).toEqual(['▛', '#D77757'])
  const capped = sprite(member({ look: 7 }), 0, 0)
  expect(capped[0]![3]).toEqual(['▀', '#F5F0E6', '#E5B35C'])
  expect(grey('#D77757')).toBe('#937166')
  const done = sprite(member({ status: 'done' }), 0, 0)
  expect(done[0]![0]).toEqual(['✓', '#5FB86A'])
  expect(done[0]![2]).toEqual(['^', '#1E1A22', '#D77757'])
  const failed = sprite(member({ status: 'failed' }), 0, 0)
  expect(failed[1]![1]).toEqual(['▀▜▀▛', '#937166'])
  expect(failed[0]![2]).toEqual(['×', '#1E1A22', '#937166'])
})

test('a done Clawd raises its arm and holds up a still grey flag', () => {
  const at = (tick: number) => {
    const [head, arms] = sprite(member({ status: 'done' }), tick, 0)
    return { hand: head![5], flag: head![6], shoulder: arms![2] }
  }
  for (const tick of [0, 1, 2, 3]) expect(at(tick).flag).toEqual(['▛', '#B5B5B5'])
  expect(at(0).hand).toEqual(['▙', '#D77757'])
  expect(at(0).shoulder).toEqual(['▘', '#D77757'])
})
