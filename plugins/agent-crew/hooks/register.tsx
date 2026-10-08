import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CrewMember, CrewStatus } from '../types'

const PANE = 'agent-crew'
const TITLE = 'Agent Crew'
const MAX_CREW = 12
/** How long the pane lingers after the last agent clocks out, so the finish can be seen. */
const CLOSE_DELAY_MS = 10_000

let pendingClose: { cancel: () => void } | undefined

function cancelClose(): void {
  pendingClose?.cancel()
  pendingClose = undefined
}

const crew = atom({ plugin: 'agent-crew', key: 'crew' } as const, [])
const frame = atom({ plugin: 'agent-crew', key: 'frame' } as const, 0)

// ── the little critters ──────────────────────────────────────────────

const BODY_COLORS = ['#E8826B', '#6BB8E8', '#E8C46B', '#8FD16B', '#C38BE8', '#E86BA8']
const HATS = [' ▄███▄ ', ' ▄▀▀▀▄ ', '  ▄█▄  ', '▄▄███▄ ', ' ▗███▖ ', ' ▄▓▓▓▄ ']
const HAT_COLORS = ['#2FAE7A', '#E8E8E8', '#3D6FD6', '#D9A72B', '#B33A3A', '#7A7A7A']
const EYES = ['◕ ◕', '◕ ◕', '◔ ◔', '◕ ◕', '◑ ◑', '◕ ◕', '- -', '◕ ◕']
const LEGS = ['  ┘ └  ', '  └ ┘  ']
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function sprite(member: CrewMember, tick: number): { hat: string; face: string; legs: string } {
  const hat = HATS[member.look % HATS.length] ?? HATS[0]!
  if (member.status === 'done') return { hat, face: ' ▐^ ^▌⚑', legs: LEGS[0]! }
  if (member.status === 'failed') return { hat, face: ' ▐x x▌ ', legs: '  ┴ ┴  ' }
  if (member.status === 'stopped') return { hat, face: ' ▐- -▌z', legs: '  ┴ ┴  ' }
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
        if (list.some(m => m.status === 'working')) await update($, frame, n => n + 1)
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
    }
    cancelClose()
    await update($, crew, list => {
      const look = list.length === 0 ? 0 : (list[list.length - 1]!.look + 1) % 60
      return [...list, { ...member, look }].slice(-MAX_CREW)
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return started
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

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{working > 0 ? `${SPINNER[tick % SPINNER.length]} ` : '✓ '}</Text>
          <Text bold>{working} working</Text>
          <Text dimColor>
            {' · '}
            {finished} done · {tokens(total)} tok · {clock(lastEnd - firstStart)}
          </Text>
        </Box>
        {list.map(m => {
          const look = sprite(m, tick)
          const body = BODY_COLORS[m.look % BODY_COLORS.length]!
          const hatColor = HAT_COLORS[Math.floor(m.look / BODY_COLORS.length) % HAT_COLORS.length]!
          const r = role(m.type)
          const elapsed = clock((m.endedAt ?? now) - m.startedAt)
          const stats = ` ${m.steps} steps · ${tokens(m.tokens)} · ${elapsed}`
          const { filled, empty } = bar(progress(m), width - 8 - stats.length - 1)
          const isLive = m.status === 'working'
          const barColor = m.status === 'failed' ? 'error' : m.status === 'stopped' ? 'warning' : isLive ? ROLE_COLORS[r]! : 'success'

          return (
            <Box key={m.id} flexDirection="row" marginTop={1}>
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
                  <Text dimColor> {m.type} · {shortModel(m.model)}</Text>
                </Text>
                <Text wrap="truncate-end" dimColor={!isLive}>
                  {isLive ? `${SPINNER[(tick + m.look) % SPINNER.length]} ${activity(m.lastTool)}…` : quip(m)}
                </Text>
                <Text wrap="truncate-end">
                  <Text color={barColor}>{filled}</Text>
                  <Text dimColor>{empty}</Text>
                  <Text dimColor>{stats}</Text>
                </Text>
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
