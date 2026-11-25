import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Exchange, Position } from './exchange/types'
import { liqDistancePct } from './exchange/types'
import { parseCommand, type Command } from './parse'
import { rankActions, RISK_PCT, fmt, type Action } from './playbook'
import { canonicalise } from './llm'

export interface Alert { id: number; symbol: string; op: '<' | '>'; price: number }
export interface PositionView extends Position { liqPct: number; history: number[]; actions: Action[] }
export interface State {
  exchange: string
  positions: PositionView[]
  alerts: Alert[]
  triggered: Alert[]
  risk: string | null // symbol whose liq distance is under RISK_PCT
  liquidated: string[] // paper only: closed by liquidation since the last poll
  updated: number
}

export interface Deps {
  exchange: Exchange
  /** Recent 1-minute closes per symbol, oldest first (chart backfill). */
  candles?: (symbol: string) => Promise<number[]>
  transcribe?: (pcm: Uint8Array) => Promise<string>
  /** Demo-only hook, paper exchange only. */
  nudge?: (symbol: string, pct: number) => void
  /** Demo-only hook, paper exchange only. */
  reset?: () => void
}

const HISTORY = 30
const SAMPLE_MS = 2000

export function createApp({ exchange, transcribe, nudge, reset, candles }: Deps) {
  const history: Record<string, number[]> = {}
  const lastSample: Record<string, number> = {}
  let alerts: Alert[] = []
  let triggered: Alert[] = []
  let nextId = 1
  let busy = false

  async function state(): Promise<State> {
    const ps = await exchange.positions()
    const now = Date.now()
    for (const p of ps) {
      // History = last 30 one-minute closes (refreshed every 30 s) with the live mark as the last point.
      if (candles && now - (lastSample[p.symbol] ?? 0) >= 30000) {
        history[p.symbol] = await candles(p.symbol).catch(() => history[p.symbol] ?? [])
        lastSample[p.symbol] = now
      }
      const h = (history[p.symbol] ??= [])
      if (!candles && now - (lastSample[p.symbol] ?? 0) >= SAMPLE_MS) { h.push(p.mark); lastSample[p.symbol] = now }
      while (h.length > HISTORY) h.shift()
    }
    // Fire alerts against the current marks.
    const marks = Object.fromEntries(ps.map(p => [p.symbol, p.mark]))
    for (const a of alerts) {
      const m = marks[a.symbol]
      if (m !== undefined && (a.op === '<' ? m <= a.price : m >= a.price)) triggered.push(a)
    }
    alerts = alerts.filter(a => !triggered.includes(a))
    const positions = ps.map(p => ({ ...p, liqPct: liqDistancePct(p), history: [...(history[p.symbol] ?? []), p.mark], actions: rankActions(p) }))
    const risky = positions.filter(p => p.liqPct < RISK_PCT).sort((a, b) => a.liqPct - b.liqPct)[0]
    const liquidated = exchange.takeLiquidations?.() ?? []
    return { exchange: exchange.name, positions, alerts, triggered: [...triggered], risk: risky?.symbol ?? null, liquidated, updated: now }
  }

  /** Human sentence for the confirm card, e.g. "Close 50% of BTC long". */
  async function describe(c: Command): Promise<string> {
    if (c.kind === 'unknown') return c.reason ?? "Didn't catch that"
    const coin = c.symbol.replace('USDT', '')
    const pos = (await exchange.positions()).find(p => p.symbol === c.symbol)
    const side = pos ? (pos.side === 'Buy' ? 'long' : 'short') : ''
    switch (c.kind) {
      case 'close': return c.fraction >= 1 ? `Close all ${coin} ${side}` : `Close ${Math.round(c.fraction * 100)}% of ${coin} ${side}`
      case 'stop': return c.price === 'breakeven' ? `Stop ${coin} at breakeven${pos ? ` ${fmt(pos.entry)}` : ''}` : `Stop ${coin} at ${fmt(c.price)}`
      case 'tp': return `Take profit ${coin} at ${fmt(c.price)}`
      case 'alert': return `Alert when ${coin} ${c.op === '<' ? 'drops below' : 'goes above'} ${fmt(c.price)}`
    }
  }

  async function execute(c: Command): Promise<string> {
    if (c.kind === 'unknown') throw new Error(c.reason ?? "Didn't catch that")
    if (busy) throw new Error('Busy, try again')
    busy = true
    try {
      const coin = c.symbol.replace('USDT', '')
      switch (c.kind) {
        case 'close': {
          const pnl = await exchange.close(c.symbol, c.fraction)
          return `Closed ${c.fraction >= 1 ? 'all' : Math.round(c.fraction * 100) + '%'} ${coin}  ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)} realised`
        }
        case 'stop': {
          const pos = (await exchange.positions()).find(p => p.symbol === c.symbol)
          if (!pos) throw new Error(`No open ${coin} position`)
          const price = c.price === 'breakeven' ? pos.entry : c.price
          const wrongSide = pos.side === 'Buy' ? price >= pos.mark : price <= pos.mark
          if (wrongSide) throw new Error(`Stop ${fmt(price)} is past the mark ${fmt(pos.mark)}`)
          await exchange.setStop(c.symbol, price)
          return `Stop set  ${coin} ${fmt(price)}`
        }
        case 'tp': {
          await exchange.setTakeProfit(c.symbol, c.price)
          return `Take profit set  ${coin} ${fmt(c.price)}`
        }
        case 'alert': {
          alerts.push({ id: nextId++, symbol: c.symbol, op: c.op, price: c.price })
          return `Alert armed  ${coin} ${c.op === '<' ? 'below' : 'above'} ${fmt(c.price)}`
        }
      }
    } finally {
      busy = false
    }
  }

  async function understand(text: string): Promise<{ text: string; command: Command; summary: string }> {
    const open = (await exchange.positions()).map(p => p.symbol)
    let command = parseCommand(text, open)
    if (command.kind === 'unknown' && !command.reason) {
      const canon = await canonicalise(text, open).catch(() => null)
      if (canon) {
        const second = parseCommand(canon, open)
        if (second.kind !== 'unknown') command = second
      }
    }
    return { text, command, summary: await describe(command) }
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
    const url = new URL(req.url ?? '/', 'http://x')
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true, exchange: exchange.name, stt: Boolean(transcribe) })
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, await state())
      const body = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0)
      let json: Record<string, unknown> = {}
      try { json = url.pathname === '/api/voice' ? {} : JSON.parse(body.toString() || '{}') } catch { if (req.method === 'POST' && url.pathname !== '/api/voice') return send(400, { error: 'Bad JSON' }) }
      if (req.method === 'POST' && url.pathname === '/api/parse') {
        return send(200, await understand(String(json.text ?? '').slice(0, 300)))
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        if (!json.command) return send(400, { error: 'command required' })
        return send(200, { result: await execute(validate(json.command)) })
      }
      if (req.method === 'POST' && url.pathname === '/api/ack') {
        triggered = []
        return send(200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/voice') {
        if (!transcribe) return send(503, { error: 'Voice is off: run scripts/get-model.sh' })
        if (body.length < 3200) return send(200, await understand(''))
        const heard = await transcribe(new Uint8Array(body))
        console.log(`voice ${(body.length / 32000).toFixed(1)}s: "${heard}"`)
        return send(200, await understand(heard))
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/nudge' && nudge) {
        const { symbol, pct } = json as { symbol: unknown; pct: unknown }
        if (typeof symbol !== 'string' || !/^[A-Z]{2,10}USDT$/.test(symbol) || typeof pct !== 'number' || !(Math.abs(pct) <= 20)) return send(422, { error: 'Bad nudge' })
        nudge(symbol, pct)
        return send(200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/reset' && reset) {
        reset(); alerts = []; triggered = []
        return send(200, { ok: true })
      }
      send(404, { error: 'not found' })
    } catch (e) {
      send(422, { error: (e as Error).message })
    }
  }
}

const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
const sym = (s: unknown): s is string => typeof s === 'string' && /^[A-Z0-9]{2,20}USDT$/.test(s)

/** Commands come from the client: re-check every field before anything reaches an exchange. */
export function validate(raw: unknown): Command {
  const c = raw as Record<string, unknown>
  const bad = (why: string): never => { throw new Error(`Rejected: ${why}`) }
  if (!c || typeof c !== 'object') bad('no command')
  if (c.kind === 'unknown') bad(String(c.reason ?? "didn't catch that"))
  if (!sym(c.symbol)) bad('symbol')
  const symbol = c.symbol as string
  switch (c.kind) {
    case 'close': return pos(c.fraction) && c.fraction <= 1 ? { kind: 'close', symbol, fraction: c.fraction } : bad('fraction')
    case 'stop': return c.price === 'breakeven' || pos(c.price) ? { kind: 'stop', symbol, price: c.price as number | 'breakeven' } : bad('price')
    case 'tp': return pos(c.price) ? { kind: 'tp', symbol, price: c.price } : bad('price')
    case 'alert': return pos(c.price) && (c.op === '<' || c.op === '>') ? { kind: 'alert', symbol, op: c.op, price: c.price } : bad('alert')
    default: return bad('unknown action')
  }
}

const MAX_BODY = 16000 * 2 * 30 // 30 s of 16 kHz s16 audio
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = []
    let n = 0
    req.on('data', (c: Buffer) => {
      n += c.length
      if (n > MAX_BODY) { rej(new Error('Body too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => res(Buffer.concat(chunks)))
    req.on('error', rej)
  })
}
