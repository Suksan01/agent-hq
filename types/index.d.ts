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
  /** Its joyful nickname, picked once when first seen and unique among the agents (see hooks/names.ts). */
  nickname?: string
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

/** One role of a team, as `.claude/agent-hq/team.json` defines it (see hooks/team.ts). */
export type HqTeamRole = {
  id: string // the agent type's short name: letters, digits, _ and -
  title: string // what the sidebar shows, e.g. "Senior Dev"
  count: number // how many of it the lead may run at once
  mission: string
  tasks: string[]
  rules: string[]
  skills: string[] // installed skills preloaded into the agent
  playbook?: string // a skill file written for this role, read at the start of each run
  tools?: string[] // left out: every tool the session has
  model?: string // haiku, sonnet, opus, inherit or a full id
  effort?: string
  /** Rules the guard enforces on this role's tool calls (see hooks/guard.ts); noPush also follows from a "never push/merge/publish" rule. */
  guard?: { noPush?: boolean; readOnly?: boolean; paths?: string[] }
}

/** What the lead told an agent to do (hq_assign / hq_review): kept for the rule guard (`paths`) and for reviews (`task`). */
export type HqAssignment = { role: string; name: string; task: string; paths?: string[]; at: number }

/** What an agent is doing now (hooks/activity.ts): a short safe line for its tool call, from `since`; `endedAt` once the call ended. */
export type HqActivity = { text: string; since: number; callId: string; endedAt?: number }

/** A team: the lead the main session plays, and the roles it hands work to. */
export type HqTeam = {
  name: string
  purpose: string
  lead: { title: string; rules: string[]; skills: string[]; model?: string } // model: what the main session should run on
  roles: HqTeamRole[]
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
      /** The team in force (project team.json first, then the home folder's), or null. */
      team: HqTeam | null
      /** Where it was read from, or why the file found was refused. */
      teamSource: { path: string; error?: string; needsApproval?: boolean } | null
      /** The highest request id from the live page that was run, so a reload never runs one twice; the server stops re-sending up to it. */
      lastAction: number
      /** What became of the last request from the live page, shown there. */
      liveNotice: { seq: number; ok: boolean; text: string } | null
      /** `/hq web` started the live page in this session: a hot reload starts it again. */
      isWebWanted: boolean
      /** What the lead assigned each agent, by agent name. */
      assignments: Record<string, HqAssignment>
      /** Permission asks the engine put to the person, by tool call id (see hooks/inbox.ts). */
      asks: Record<string, { agent: string; since: number; what: string }>
      /** Tokens and working time per agent id, from turn.complete (see hooks/usage.ts). */
      usage: Record<string, { turns: number; workMs: number; inputTokens: number; outputTokens: number; cachedTokens: number; model?: string }>
      /** When each agent now `waiting` began to, by agent id. */
      waitingSince: Record<string, number>
      /** Each agent's last answer (clipped), by agent id, for reviews. */
      results: Record<string, string>
      /** Each agent's current (or last) tool call as a short line, by agent id (see hooks/activity.ts). */
      activity: Record<string, HqActivity>
      /** The activity feed on the live page (see hooks/feed.ts). */
      feed: { next: number; events: { n: number; at: number; agent: string; kind: 'tool' | 'step' | 'status' | 'message' | 'action'; text: string }[] }
    }
  }
}
