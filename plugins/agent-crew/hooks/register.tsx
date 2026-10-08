import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

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

/** Each crew member is a Clawd: body colour from look % 6, cap colour from look / 6. */
const BODY_COLORS = ['#D77757', '#E5B35C', '#E07A9A', '#8DBF6A', '#6FA8DC', '#A98ADB']
/** The cap tints the top half of the head; the first Clawd goes bareheaded. */
const CAP_COLORS = [null, '#F5F0E6', '#D2453A', '#2BA89A', '#34508F', '#5A4636']
/** Every sprite row is this many cells: a status mark, Clawd, and a gap before the text. */
export const SPRITE_WIDTH = 10

/** Clawd's own eyes are notches cut in the head; every other look is a glyph drawn on it. */
const EYES_OPEN = ['▛', '▜'] as const
const EYES_SHUT = ['─', '─'] as const
const EYES_ALERT = ['●', '●'] as const
const EYES_HAPPY = ['^', '^'] as const
const EYES_DAZED = ['×', '×'] as const
const EYE_COLOR = '#1E1A22'
const CHEEKS = ['▘', '▝'] as const
const CHEEK_COLOR = '#FF8FAB'
/** Left arm, right arm, and the raised right arm beside the head, joined at the shoulder. */
const ARMS_DOWN = ['▝', '▘', ' '] as const
const ARMS_WAVE = ['▝', '▘', '▖'] as const
const FEET = '  ▘▘ ▝▝   '

const MARK_WORK = '*'
const MARK_BLINK = '·'
const MARK_TALK = '~'
const MARK_LISTEN = '!'
const MARK_DONE = '✓'
const MARK_FAILED = '×'
const MARK_STOPPED = 'z'
const TALK_COLOR = '#7FB8E6'
const LISTEN_COLOR = '#E8C46B'
const DONE_COLOR = '#5FB86A'
/** A done Clawd plants a little grey flag on its shoulder: the pole is the cell's left half, the banner stays put. */
const FLAG = '▛'
const FLAG_COLOR = '#B5B5B5'
const FAILED_COLOR = '#E05A4F'
const STOPPED_COLOR = '#8A8A8A'

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** A run of cells in one foreground and optional background colour. */
export type Span = [text: string, fg?: string, bg?: string]

/** Washes a colour most of the way to grey, for crew members who failed or were sent home. */
export function grey(hex: string): string {
  const mix = (at: number) => Math.round(0.35 * parseInt(hex.slice(at, at + 2), 16) + 0.65 * 110)
  return `#${[1, 3, 5].map(at => mix(at).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

type Pose = {
  body: string
  cap: string | null
  cheek: string
  eyes: readonly [string, string]
  arms: readonly [string, string, string]
  mark: string
  markColor?: string
  /** The raised arm's colour, when it holds something other than itself. */
  raisedColor?: string
}

function clawd({ body, cap, cheek, eyes, arms, mark, markColor, raisedColor = body }: Pose): Span[][] {
  const [left, right, raised] = arms
  const eye = (glyph: string): Span => (eyes === EYES_OPEN ? [glyph, body] : [glyph, EYE_COLOR, body])
  return [
    [
      markColor === undefined ? [mark] : [mark, markColor],
      ['▐', body],
      eye(eyes[0]),
      cap === null ? ['███', body] : ['▀▀▀', cap, body],
      eye(eyes[1]),
      ['▌', body],
      [raised, raisedColor],
      [' '],
    ],
    [
      [`${left}▜`, body],
      [CHEEKS[0], cheek, body],
      ['███', body],
      [CHEEKS[1], cheek, body],
      [`▛${right}`, body],
      [' '],
    ],
    [[FEET, body]],
  ]
}

/** The mood showing right now: a listener's starts only once the letter lands. */
function moodAt(member: CrewMember, now: number): CrewMood | undefined {
  const mood = member.mood
  return mood !== undefined && now >= mood.since && now < mood.until ? mood : undefined
}

export function sprite(member: CrewMember, tick: number, now: number): Span[][] {
  const body = BODY_COLORS[member.look % BODY_COLORS.length]!
  const cap = CAP_COLORS[Math.floor(member.look / BODY_COLORS.length) % CAP_COLORS.length]!
  const off = { body: grey(body), cap: cap === null ? null : grey(cap), cheek: grey(CHEEK_COLOR), arms: ARMS_DOWN }
  if (member.status === 'done') {
    return clawd({ body, cap, cheek: CHEEK_COLOR, eyes: EYES_HAPPY, arms: [ARMS_DOWN[0], ARMS_DOWN[1], FLAG], mark: MARK_DONE, markColor: DONE_COLOR, raisedColor: FLAG_COLOR })
  }
  if (member.status === 'failed') return clawd({ ...off, eyes: EYES_DAZED, mark: MARK_FAILED, markColor: FAILED_COLOR })
  if (member.status === 'stopped') return clawd({ ...off, eyes: EYES_SHUT, mark: MARK_STOPPED, markColor: STOPPED_COLOR })
  const mood = moodAt(member, now)
  if (mood?.kind === 'talk') {
    return clawd({ body, cap, cheek: CHEEK_COLOR, eyes: EYES_OPEN, arms: tick % 2 === 0 ? ARMS_WAVE : ARMS_DOWN, mark: MARK_TALK, markColor: TALK_COLOR })
  }
  if (mood?.kind === 'listen') return clawd({ body, cap, cheek: CHEEK_COLOR, eyes: EYES_ALERT, arms: ARMS_DOWN, mark: MARK_LISTEN, markColor: LISTEN_COLOR })
  const phase = (tick + member.look) % 4
  return clawd({
    body,
    cap,
    cheek: CHEEK_COLOR,
    eyes: phase === 1 ? EYES_SHUT : EYES_OPEN,
    arms: phase === 3 ? ARMS_WAVE : ARMS_DOWN,
    mark: phase % 2 === 0 ? MARK_WORK : MARK_BLINK,
    markColor: body,
  })
}

/** The Clawd on the empty pane, asleep. */
const NAPPING = clawd({ body: BODY_COLORS[0]!, cap: null, cheek: CHEEK_COLOR, eyes: EYES_SHUT, arms: ARMS_DOWN, mark: MARK_STOPPED, markColor: STOPPED_COLOR })

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

/** What a SendMessage `to` may call the main conversation: teammates say `team-lead`, background subagents `main`. */
const LEAD_ALIASES = new Set(['team-lead', 'main', LEAD])

/** The crew member (or the lead) a SendMessage `to` names: a name, an agent id, or `name@team`. */
export function addressee(list: readonly CrewMember[], to: string): string | undefined {
  const bare = to.split('@')[0]!
  if (LEAD_ALIASES.has(bare)) return LEAD
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

/** Sends a letter down the lane: the sender talks, the receiver perks up once it lands. */
async function post($: EngineInterface, from: string, to: string, body: string): Promise<void> {
  const now = await $.clock.now()
  const text = snippet(body)
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
    // A new batch after the last one all clocked out starts a fresh crew. Decided inside
    // the update, so agents spawned in parallel see each other instead of each starting over.
    let isFresh = false
    await update($, crew, list => {
      isFresh = list.every(m => m.status !== 'working')
      const kept = isFresh ? [] : list
      const look = kept.length === 0 ? 0 : (kept[kept.length - 1]!.look + 1) % 60
      return [...kept, { ...member, look }].slice(-MAX_CREW)
    })
    if (isFresh) await update($, mail, () => [])
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

    await post($, from, to, e.text)

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
    // The engine hands an answered run's report to the lead without a SendMessage, so mail it here.
    if (isKnown && status === 'done') await post($, agentId, LEAD, e.answer || 'report')
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
    const drawn = (rows: Span[][], id: string) => (
      <Box flexDirection="column" width={SPRITE_WIDTH}>
        {rows.map((spans, row) => (
          <Text key={`${id}-${row}`}>
            {spans.map(([text, fg, bg], k) => (
              <Text key={`${id}-${row}-${k}`} color={fg} backgroundColor={bg}>
                {text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    )

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          {drawn(NAPPING, 'napping')}
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
          const mood = moodAt(m, now)
          const body = BODY_COLORS[m.look % BODY_COLORS.length]!
          const r = role(m.type)
          const elapsed = clock((m.endedAt ?? now) - m.startedAt)
          const post = m.sent + m.received > 0 ? ` · ✉${m.sent}↑${m.received}↓` : ''
          const stats = ` ${m.steps} steps · ${tokens(m.tokens)} · ${elapsed}${post}`
          const { filled, empty } = bar(progress(m), width - SPRITE_WIDTH - (hasMail ? LANE_WIDTH : 0) - stats.length - 1)
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
                {drawn(sprite(m, tick, now), m.id)}
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
