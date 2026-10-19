export type HqStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
export type HqTaskStatus = 'pending' | 'in_progress' | 'completed'

/** One agent loop: `main` is the orchestrator, every other key an agent id. */
export type HqAgent = {
  id: string
  name: string
  role: string
  description: string
  status: HqStatus
  parentId?: string
  startedAt: number
  endedAt?: number
  tools: number
  lastTool?: string
  /** Which mascot species it got when first seen (main has none: it is the lead). */
  mascot?: number
}

export type HqTodo = { content: string; status: HqTaskStatus; activeForm: string }

export type HqTask = {
  id: string
  subject: string
  status: HqTaskStatus
  owner?: string
  activeForm?: string
  blockedBy: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-hq': {
      agents: Record<string, HqAgent>
      todos: Record<string, HqTodo[]>
      tasks: Record<string, HqTask>
      now: number
      hideFinished: boolean
      wasAutoOpened: boolean
      /** The person closed the band; the next spawned agent brings it back. */
      isBandHidden: boolean
      /** plan-progress bar id -> the loop that last moved it, so a bar's steps read as that agent's todos. */
      barOwners: Record<string, { owner: string; at: number }>
    }
  }
}
