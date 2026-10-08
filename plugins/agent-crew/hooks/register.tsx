import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CrewMember, CrewMood, CrewStatus, Letter } from '../types'

const PANE = 'agent-crew'
const TITLE = 'Agent Crew'
const MAX_CREW = 12
/** How long the pane lingers after the last agent clocks out, so the finish can be seen. */
const CLOSE_DELAY_MS = 10_000
/** How long a letter takes to fly from sender to receiver. */
const FLIGHT_MS = 1_500
/** How long a sender keeps talking, and a receiver keeps its ears up after the letter lands. */
const MOOD_MS = 3_000
/** The main conversation, as the mail lane knows it. */
const LEAD = 'lead'

let pendingClose: { cancel: () => void } | undefined

function cancelClose(): void {
  pendingClose?.cancel()
  pendingClose = undefined
}

const crew = atom({ plugin: 'agent-crew', key: 'crew' } as const, [])
const frame = atom({ plugin: 'agent-crew', key: 'frame' } as const, 0)
const mail = atom({ plugin: 'agent-crew', key: 'mail' } as const, [])
const posted = atom({ plugin: 'agent-crew', key: 'posted' } as const, 0)

let letterId = 0

// ── the little critters ──────────────────────────────────────────────

const BODY_COLORS = ['#E8826B', '#6BB8E8', '#E8C46B', '#8FD16B', '#C38BE8', '#E86BA8']
const HATS = [' ▄███▄ ', ' ▄▀▀▀▄ ', '  ▄█▄  ', '▄▄███▄ ', ' ▗███▖ ', ' ▄▓▓▓▄ ']
const HAT_COLORS = ['#2FAE7A', '#E8E8E8', '#3D6FD6', '#D9A72B', '#B33A3A', '#7A7A7A']
const EYES = ['◕ ◕', '◕ ◕', '◔ ◔', '◕ ◕', '◑ ◑', '◕ ◕', '- -', '◕ ◕']
const LEGS = ['  ┘ └  ', '  └ ┘  ']
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** The mood showing right now: a listener's starts only once the letter lands. */
function moodAt(member: CrewMember, now: number): CrewMood | undefined {
  const mood = member.mood
  return mood !== undefined && now >= mood.since && now < mood.until ? mood : undefined
}

function sprite(member: CrewMember, tick: number, now: number): { hat: string; face: string; legs: string } {
  const hat = HATS[member.look % HATS.length] ?? HATS[0]!
  if (member.status === 'done') return { hat, face: ' ▐^ ^▌⚑', legs: LEGS[0]! }
  if (member.status === 'failed') return { hat, face: ' ▐x x▌ ', legs: '  ┴ ┴  ' }
  if (member.status === 'stopped') return { hat, face: ' ▐- -▌z', legs: '  ┴ ┴  ' }
  const mood = moodAt(member, now)
  if (mood?.kind === 'talk') return { hat, face: ` ▐◕${tick % 2 ? 'o' : '-'}◕▌`, legs: LEGS[tick % 2]! }
  if (mood?.kind === 'listen') return { hat: `${hat.slice(0, 6)}!`, face: ' ▐◉ ◉▌ ', legs: LEGS[0]! }
  const eyes = EYES[(tick + member.look) % EYES.length]!
  const spark = tick % 4 < 2 ? '✦' : '·'
  return { hat, face: ` ▐${eyes}▌${spark}`, legs: LEGS[tick % 2]! }
}

// ── words ────────────────────────────────────────────────────────────

const ROLES: Record<string, string> = {
  Explore: 'scout',
  Plan: 'architect',
  'general-purpose': 'builder',
  claude: 'handyman',
  fork: 'twin',
  teammate: 'teammate',
}
const ROLE_COLORS: Record<string, string> = {
  scout: '#D9A72B',
  architect: '#6BB8E8',
  builder: '#2FAE7A',
  handyman: '#E8826B',
  twin: '#C38BE8',
  teammate: '#E86BA8',
  specialist: '#8FD16B',
}

function role(type: string): string {
  return ROLES[type] ?? 'specialist'
}

function activity(tool: string | undefined): string {
  if (tool === undefined) return 'stretching before work'
  if (tool === 'Read') return 'reading the fine print'
  if (tool === 'Grep' || tool === 'Glob') return 'sniffing through files'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'hammering code'
  if (tool === 'Bash') return 'cranking the shell'
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'surfing the web'
  if (tool === 'Agent') return 'hatching a helper'
  if (tool.startsWith('mcp__')) return `poking ${tool.split('__')[1] ?? 'a connector'}`
  return `tinkering with ${tool}`
}

const DONE_QUIPS = ['clocked out', 'nailed it', 'back to the burrow', 'job done, snack time', 'shipped it']

function quip(member: CrewMember): string {
  if (member.status === 'failed') return 'tripped over a cable'
  if (member.status === 'stopped') return 'sent home early'
  return DONE_QUIPS[member.look % DONE_QUIPS.length]!
}

function shortModel(model: string): string {
  const m = /(opus|sonnet|haiku|fable|mythos)[-_ ]?(\d+)?[-_.]?(\d+)?/i.exec(model)
  if (m === null) return model
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  const version = [m[2], m[3]].filter(Boolean).join('.')
  return version ? `${name} ${version}` : name
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** No agent says how far along it is, so the bar creeps toward 95% with each step. */
export function progress(member: CrewMember): number {
  if (member.status !== 'working') return 1
  return Math.min(0.95, 1 - 1 / (1 + member.steps / 6))
}

export function bar(fraction: number, width: number): { filled: string; empty: string } {
  const cells = Math.max(1, width)
  const full = Math.round(fraction * cells)
  return { filled: '█'.repeat(full), empty: '░'.repeat(cells - full) }
}

function statusOf(reason: string): CrewStatus {
  if (reason === 'aborted') return 'stopped'
  if (reason === 'answer') return 'done'
  return 'failed'
}

// ── mail ─────────────────────────────────────────────────────────────

/** The crew member (or the lead) a SendMessage `to` names: a name, an agent id, or `name@team`. */
export function addressee(list: readonly CrewMember[], to: string): string | undefined {
  const bare = to.split('@')[0]!
  if (bare === 'team-lead' || bare === LEAD) return LEAD
  return list.find(m => m.id === to || m.name === to || m.name === bare)?.id
}

function nameOf(list: readonly CrewMember[], id: string): string {
  if (id === LEAD) return LEAD
  const m = list.find(x => x.id === id)
  return m === undefined ? '?' : (m.name ?? role(m.type))
}

function snippet(text: string): string {
  const line = text.trim().split('\n')[0]!.trim()
  return line.length > 36 ? `${line.slice(0, 35)}…` : line
}

/** The body color a letter from this sender travels in; the lead's is white. */
function inkOf(list: readonly CrewMember[], id: string): string {
  const m = list.find(x => x.id === id)
  return m === undefined ? '#E8E8E8' : BODY_COLORS[m.look % BODY_COLORS.length]!
}

export type LaneCell = { char: string; color?: string; isFaded?: boolean }

/** Side-by-side tracks in the lane, so letters crossing the same stretch don't hide each other. */
const TRACKS = 2
export const LANE_WIDTH = TRACKS * 2

/**
 * The mail lane, LANE_WIDTH cells per pane line: the header line is the lead's
 * house, and each crew member's face line is where its letters leave and land. A
 * letter draws a bracket in its sender's color, `╭─` at the sender and `╰▶` at the
 * receiver, with ✉ riding it; once it lands the bracket fades and lingers while the
 * receiver reads. Letters whose stretches overlap take separate tracks.
 */
export function lane(list: readonly CrewMember[], letters: readonly Letter[], now: number): LaneCell[][] {
  const rows = 1 + list.length * 5
  const grid: LaneCell[][] = Array.from({ length: rows }, () => Array.from({ length: LANE_WIDTH }, () => ({ char: ' ' })))
  grid[0]![0] = { char: '⌂', color: '#E8E8E8' }
  const anchor = (id: string): number | undefined => {
    if (id === LEAD) return 0
    const i = list.findIndex(m => m.id === id)
    return i < 0 ? undefined : 1 + i * 5 + 2
  }
  const taken: [number, number][][] = Array.from({ length: TRACKS }, () => [])
  for (const letter of [...letters].sort((x, y) => x.sentAt - y.sentAt)) {
    const a = anchor(letter.from)
    const b = anchor(letter.to)
    if (a === undefined || b === undefined) continue
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const free = taken.findIndex(spans => spans.every(([l, h]) => hi < l || lo > h))
    const track = free < 0 ? TRACKS - 1 : free
    taken[track]!.push([lo, hi])

    const x = track * 2
    const p = (now - letter.sentAt) / FLIGHT_MS
    const color = inkOf(list, letter.from)
    const isFaded = p >= 1
    const put = (row: number, col: number, char: string, faded = isFaded) => {
      grid[row]![col] = { char, color, isFaded: faded }
    }
    for (let row = lo + 1; row < hi; row++) put(row, x, '│')
    for (const [row, isEnd] of [[a, false], [b, true]] as const) {
      if (row === 0) {
        // the lead's house: run the arm back to ⌂, which glows in the sender's color
        for (let col = 1; col < x; col++) put(0, col, '─')
        if (x > 0) put(0, x, '┐')
        grid[0]![0] = { char: '⌂', color }
        continue
      }
      put(row, x, row === lo ? '╭' : '╰')
      for (let col = x + 1; col < LANE_WIDTH - 1; col++) put(row, col, '─')
      put(row, LANE_WIDTH - 1, isEnd ? '▶' : '─')
    }
    if (!isFaded) {
      const at = Math.round(a + (b - a) * Math.max(0, p))
      if (at !== 0) put(at, x, '✉', false)
    }
  }
  return grid
}

// ── hooks ────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'crew',
      description: 'Open the Agent Crew pane: your subagents at work',
    })
    $.clock.every(250, () => {
      void (async () => {
        const list = await read($, crew)
        const letters = await read($, mail)
        const now = await $.clock.now()
        const isStale = (l: Letter) => now - l.sentAt >= FLIGHT_MS + MOOD_MS
        if (letters.some(isStale)) await update($, mail, all => all.filter(l => !isStale(l)))
        const isMoody = list.some(m => m.mood !== undefined && now < m.mood.until)
        if (list.some(m => m.status === 'working') || letters.length > 0 || isMoody) {
          await update($, frame, n => n + 1)
        }
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'crew' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Agent Crew pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId === undefined) return started

    const now = await $.clock.now()
    const member: CrewMember = {
      id: started.agentId,
      task: e.description || e.subagentType,
      type: e.subagentType,
      model: started.model,
      startedAt: now,
      steps: 0,
      tokens: 0,
      status: 'working',
      look: 0,
      name: started.teammateId?.split('@')[0] ?? e.name,
      sent: 0,
      received: 0,
    }
    cancelClose()
    // A new batch after the last one all clocked out starts a fresh crew.
    const isFresh = (await read($, crew)).every(m => m.status !== 'working')
    if (isFresh) await update($, mail, () => [])
    await update($, crew, list => {
      const kept = isFresh ? [] : list
      const look = kept.length === 0 ? 0 : (kept[kept.length - 1]!.look + 1) % 60
      return [...kept, { ...member, look }].slice(-MAX_CREW)
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return started
  }).catch(($, e, next) => next(e))

  on('session.send', async ($, e, next) => {
    const result = await next(e)
    if (!result.isDelivered) return result

    const list = await read($, crew)
    const from = e.agentId === undefined ? LEAD : list.find(m => m.id === e.agentId)?.id
    const to = addressee(list, e.to)
    if (from === undefined || to === undefined || from === to) return result

    const now = await $.clock.now()
    const text = snippet(e.text)
    await update($, crew, all =>
      all.map(m => {
        if (m.id === from) {
          return { ...m, sent: m.sent + 1, mood: { kind: 'talk' as const, peer: nameOf(all, to), ink: inkOf(all, from), text, since: now, until: now + MOOD_MS } }
        }
        if (m.id !== to) return m
        const mood: CrewMood = { kind: 'listen', peer: nameOf(all, from), ink: inkOf(all, from), text, since: now + FLIGHT_MS, until: now + FLIGHT_MS + MOOD_MS }
        // A message wakes a teammate that went idle, or a subagent it resumes.
        const awake = m.status === 'working' ? {} : { status: 'working' as const, endedAt: undefined }
        return { ...m, ...awake, received: m.received + 1, mood }
      }),
    )
    await update($, mail, all => [...all, { id: ++letterId, from, to, sentAt: now }])
    await update($, posted, n => n + 1)
    if (to !== LEAD) cancelClose()

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      await update($, crew, list =>
        list.map(m =>
          m.id === agentId && m.status === 'working'
            ? { ...m, steps: m.steps + 1, lastTool: String(e.tool) }
            : m,
        ),
      )
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) return next(e)

    const now = await $.clock.now()
    const used = e.usage
      ? e.usage.input_tokens +
        e.usage.output_tokens +
        e.usage.cache_read_input_tokens +
        (e.usage.cache_creation_input_tokens ?? 0)
      : 0
    const status = statusOf(e.reason)
    let isKnown = false
    await update($, crew, list =>
      list.map(m => {
        if (m.id !== agentId) return m
        isKnown = true
        return {
          ...m,
          status,
          endedAt: now,
          tokens: m.tokens + used,
          model: e.usage?.model ?? m.model,
        }
      }),
    )
    await update($, frame, n => n + 1)

    const after = await read($, crew)
    if (isKnown && after.length >= 2 && after.every(m => m.status !== 'working')) {
      const done = after.filter(m => m.status === 'done').length
      $.ui.toast(`🎉 Crew's done: ${done}/${after.length} agents clocked out`)
    }
    if (isKnown && after.every(m => m.status !== 'working')) {
      cancelClose()
      pendingClose = $.clock.after(CLOSE_DELAY_MS, () => {
        pendingClose = undefined
        void (async () => {
          const list = await read($, crew)
          if (list.every(m => m.status !== 'working')) await $.ui.close({ id: PANE })
        })()
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, crew)
    const tick = await read($, frame)
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns)

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color="#8FD16B">{'  ▄███▄  '}</Text>
          <Text color="#E8826B">{'  ▐- -▌z '}</Text>
          <Text color="#E8826B">{'   ┴ ┴   '}</Text>
          <Text dimColor>The crew is napping. Ask for something big and they'll get to work.</Text>
        </Box>
      )
    }

    const working = list.filter(m => m.status === 'working').length
    const finished = list.length - working
    const total = list.reduce((sum, m) => sum + m.tokens, 0)
    const firstStart = Math.min(...list.map(m => m.startedAt))
    const lastEnd = working > 0 ? now : Math.max(...list.map(m => m.endedAt ?? now))
    const letters = await read($, mail)
    const messages = await read($, posted)
    const hasMail = list.some(m => m.sent + m.received > 0) || letters.length > 0
    const cells = hasMail ? lane(list, letters, now) : []
    const gutter = (row: number) =>
      hasMail ? (
        <Text key={`lane-${row}`}>
          {(cells[row] ?? []).map((cell, col) => (
            <Text key={`${row}-${col}`} color={cell.color} dimColor={cell.isFaded === true}>
              {cell.char}
            </Text>
          ))}
        </Text>
      ) : null

    return (
      <Box flexDirection="column">
        <Box>
          {gutter(0)}
          <Text bold>{working > 0 ? `${SPINNER[tick % SPINNER.length]} ` : '✓ '}</Text>
          <Text bold>{working} working</Text>
          <Text dimColor>
            {' · '}
            {finished} done · {tokens(total)} tok · {clock(lastEnd - firstStart)}
            {messages > 0 ? ` · 💌 ${messages}` : ''}
          </Text>
        </Box>
        {list.map((m, i) => {
          const look = sprite(m, tick, now)
          const mood = moodAt(m, now)
          const body = BODY_COLORS[m.look % BODY_COLORS.length]!
          const hatColor = HAT_COLORS[Math.floor(m.look / BODY_COLORS.length) % HAT_COLORS.length]!
          const r = role(m.type)
          const elapsed = clock((m.endedAt ?? now) - m.startedAt)
          const post = m.sent + m.received > 0 ? ` · ✉${m.sent}↑${m.received}↓` : ''
          const stats = ` ${m.steps} steps · ${tokens(m.tokens)} · ${elapsed}${post}`
          const { filled, empty } = bar(progress(m), width - 8 - (hasMail ? LANE_WIDTH : 0) - stats.length - 1)
          const isLive = m.status === 'working'
          const barColor = m.status === 'failed' ? 'error' : m.status === 'stopped' ? 'warning' : isLive ? body : 'success'
          const doing =
            mood?.kind === 'talk'
              ? `💬 → ${mood.peer}: "${mood.text}"`
              : mood?.kind === 'listen'
                ? `📬 from ${mood.peer}: "${mood.text}"`
                : isLive
                  ? `${SPINNER[(tick + m.look) % SPINNER.length]} ${activity(m.lastTool)}…`
                  : quip(m)
          const top = 1 + i * 5

          return (
            <Box key={m.id} flexDirection="row">
              {hasMail && <Box flexDirection="column">{[0, 1, 2, 3, 4].map(k => gutter(top + k))}</Box>}
              <Box flexDirection="row" marginTop={1} flexGrow={1}>
                <Box flexDirection="column" width={8}>
                  <Text color={hatColor}>{look.hat}</Text>
                  <Text color={body} dimColor={!isLive}>{look.face}</Text>
                  <Text color={body} dimColor={!isLive}>{look.legs}</Text>
                </Box>
                <Box flexDirection="column" flexGrow={1}>
                  <Text bold dimColor={!isLive} wrap="truncate-end">
                    {m.task}
                  </Text>
                  <Text wrap="truncate-end">
                    <Text color={ROLE_COLORS[r]!}>{r}</Text>
                    <Text dimColor> {m.name !== undefined ? `${m.name} · ` : ''}{m.type} · {shortModel(m.model)}</Text>
                  </Text>
                  <Text wrap="truncate-end" color={mood?.ink} dimColor={!isLive && mood === undefined}>
                    {doing}
                  </Text>
                  <Text wrap="truncate-end">
                    <Text color={barColor}>{filled}</Text>
                    <Text dimColor>{empty}</Text>
                    <Text dimColor>{stats}</Text>
                  </Text>
                </Box>
              </Box>
            </Box>
          )
        })}
        {finished > 0 && (
          <Box marginTop={1}>
            <Button
              key="clear"
              label="Clear finished"
              hotkey="c"
              onPress={() => update($, crew, all => all.filter(m => m.status === 'working'))}
            />
          </Box>
        )}
      </Box>
    )
  })
}
