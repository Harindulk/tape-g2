import type { State, Command } from './types'

// Same-origin in dev (Vite proxies /api to the Tape server). Override for a hosted server.
const BASE = (import.meta.env.VITE_TAPE_API as string | undefined) ?? ''

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(20000) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`)
  return body as T
}
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export interface Understood { text: string; command: Command; summary: string }

export const api = {
  state: () => j<State>('/api/state'),
  act: (command: Command) => j<{ result: string }>('/api/action', post({ command })),
  parse: (text: string) => j<Understood>('/api/parse', post({ text })),
  voice: (pcm: Uint8Array) => j<Understood>('/api/voice', { method: 'POST', body: pcm as BodyInit }),
  ack: () => j<{ ok: true }>('/api/ack', post({})),
  nudge: (symbol: string, pct: number) => j<{ ok: true }>('/api/demo/nudge', post({ symbol, pct })),
  health: () => j<{ ok: boolean; exchange: string; stt: boolean }>('/api/health'),
}
