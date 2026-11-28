import { describe, it, expect } from 'vitest'
import { createApp } from '../server/app'
import { PaperExchange } from '../server/exchange/paper'
import type { IncomingMessage, ServerResponse } from 'node:http'

const prices: Record<string, number> = { BTCUSDT: 60000, ETHUSDT: 3000, SOLUSDT: 150 }
const setup = () => {
  const app = createApp({ exchange: new PaperExchange(async s => Object.fromEntries(s.map(k => [k, prices[k]]))) })
  const sent: string[] = []
  return { app, sent, notify: async (t: string) => { sent.push(t) } }
}
// Fake a GET /api/state from the glasses app.
const poll = (app: ReturnType<typeof createApp>) => new Promise<void>(done => {
  const res = { setHeader() {}, writeHead() { return { end: () => done() } } } as unknown as ServerResponse
  app({ method: 'GET', url: '/api/state', on() {} } as unknown as IncomingMessage, res)
})

describe('closed-app watcher', () => {
  it('stays quiet while the glasses app is polling', async () => {
    const { app, sent, notify } = setup()
    await poll(app)
    prices.SOLUSDT = 150 * 0.96
    await app.watch(notify, Date.now())
    expect(sent).toEqual([])
    prices.SOLUSDT = 150
  })
  it('sends a risk warning once per cooldown when the app is closed', async () => {
    const { app, sent, notify } = setup()
    await app.watch(notify, Date.now()) // seed the book at 150
    prices.SOLUSDT = 150 * 0.96
    const t = Date.now() + 60_000
    await app.watch(notify, t)
    await app.watch(notify, t + 10_000)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/SOL long is [0-9.]+% from liquidation/)
    await app.watch(notify, t + 6 * 60_000)
    expect(sent).toHaveLength(2)
    prices.SOLUSDT = 150
  })
})
