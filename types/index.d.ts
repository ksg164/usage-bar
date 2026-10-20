export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Snapshot = {
  limits: Limit[]
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  usd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { snap: Snapshot | null; isHidden: boolean }
  }
}
