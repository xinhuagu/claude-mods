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
}

declare module 'claude-code' {
  interface PluginState {
    'agent-crew': { crew: CrewMember[]; frame: number }
  }
}
