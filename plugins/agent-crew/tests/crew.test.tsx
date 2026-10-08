import { expect, mock, test } from 'claude-code/testing'

import { addressee, bar, lane, progress } from '../hooks/register'
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

  await clock.advance(1_600)
  const later = await $.ui.mount({ plugin: 'agent-crew', surface: 'terminal', component: 'Pane', requestId: 'agent-crew', props: PANE_PROPS })
  expect(await later.find({ text: /📬 from scout: "found 3 call sites in auth\/"/ })).toBeDefined()
  expect(await later.find({ text: /✉1↑0↓/ })).toBeDefined()
  expect(await later.find({ text: /✉0↑1↓/ })).toBeDefined()
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

  const landed = lane(list, [{ id: 1, from: 'c', to: 'a', sentAt: 0 }], 2_000)
  expect(row(landed[3]!)).toBe('╭──▶')
  expect(row(landed[13]!)).toBe('╰───')
  expect(row(landed[8]!)).toBe('│   ')
  expect(landed[8]![0]!.isFaded).toBe(true)
  expect(landed[8]![0]!.color).toBe('#E8C46B')

  const crossing = lane(list, [{ id: 1, from: 'a', to: 'c', sentAt: 0 }, { id: 2, from: 'lead', to: 'b', sentAt: 100 }], 750)
  expect(row(crossing[0]!)).toBe('⌂─┐ ')
  expect(row(crossing[8]!)).toBe('✉ ╰▶')
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
