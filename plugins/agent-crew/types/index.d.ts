export type CrewStatus = 'working' | 'done' | 'failed' | 'stopped'

export type CrewMember = {
  id: string
  task: string
  type: string
  model: string
  startedAt: number
  endedAt?: number
  steps: number
  lastTool?: string
  tokens: number
  status: CrewStatus
  look: number
  /** What SendMessage addresses it by, when it has a name. */
  name?: string
  sent: number
  received: number
  /** A short-lived face: talking while its letter flies, all ears when one lands. */
  mood?: CrewMood
}

export type CrewMood = { kind: 'talk' | 'listen'; peer: string; ink: string; text: string; since: number; until: number }

/** A letter in flight between two crew members; `lead` is the main conversation. */
export type Letter = { id: number; from: string; to: string; sentAt: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-crew': { crew: CrewMember[]; frame: number; mail: Letter[]; posted: number }
  }
}
