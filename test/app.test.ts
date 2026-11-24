import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createApp } from '../server/app'
import { PaperExchange } from '../server/exchange/paper'

let server: Server
let base = ''
const prices: Record<string, number> = { BTCUSDT: 60000, ETHUSDT: 3000, SOLUSDT: 150 }
const paper = new PaperExchange(async syms => Object.fromEntries(syms.map(s => [s, prices[s]])))

beforeAll(async () => {
  server = createServer(createApp({ exchange: paper, transcribe: async () => 'close half of eth' }))
  await new Promise<void>(r => server.listen(0, r))
  base = `http://localhost:${(server.address() as { port: number }).port}`
})
afterAll(() => server.close())

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('server', () => {
  it('state lists positions with liq distance, history and 3 actions', async () => {
    const s = await (await fetch(base + '/api/state')).json()
    expect(s.exchange).toBe('paper')
    expect(s.positions).toHaveLength(3)
    expect(s.positions[0].actions).toHaveLength(3)
    expect(s.positions[0].history.length).toBeGreaterThan(0)
    expect(s.risk).toBeNull()
  })
  it('parse returns a confirm summary', async () => {
    const r = await (await post('/api/parse', { text: 'close half of eth' })).json()
    expect(r.command).toEqual({ kind: 'close', symbol: 'ETHUSDT', fraction: 0.5 })
    expect(r.summary).toBe('Close 50% of ETH short')
  })
  it('voice runs stt then parse', async () => {
    const r = await (await fetch(base + '/api/voice', { method: 'POST', body: new Uint8Array(6400) })).json()
    expect(r.text).toBe('close half of eth')
    expect(r.command.kind).toBe('close')
  })
  it('action executes and reports realised pnl', async () => {
    const r = await (await post('/api/action', { command: { kind: 'close', symbol: 'ETHUSDT', fraction: 0.5 } })).json()
    expect(r.result).toMatch(/^Closed 50% ETH/)
  })
  it('rejects a stop on the wrong side of the mark', async () => {
    const r = await post('/api/action', { command: { kind: 'stop', symbol: 'BTCUSDT', price: 61000 } })
    expect(r.status).toBe(422)
    expect((await r.json()).error).toMatch(/past the mark/)
  })
  it('unknown command is refused, never executed', async () => {
    const r = await post('/api/action', { command: { kind: 'unknown', text: 'x' } })
    expect(r.status).toBe(422)
  })
  it('alerts fire when the mark crosses and stay until acked', async () => {
    await post('/api/action', { command: { kind: 'alert', symbol: 'BTCUSDT', op: '<', price: 59000 } })
    prices.BTCUSDT = 58900
    let s = await (await fetch(base + '/api/state')).json()
    expect(s.triggered).toHaveLength(1)
    expect(s.alerts).toHaveLength(0)
    await post('/api/ack', {})
    s = await (await fetch(base + '/api/state')).json()
    expect(s.triggered).toHaveLength(0)
    prices.BTCUSDT = 60000
  })
  it('flags risk when a position gets within 5% of liquidation', async () => {
    prices.SOLUSDT = 150 * 0.96 // SOL long 12x entered ~150.6 → liq ≈ 138.8
    const s = await (await fetch(base + '/api/state')).json()
    expect(s.risk).toBe('SOLUSDT')
    prices.SOLUSDT = 150
  })
})
