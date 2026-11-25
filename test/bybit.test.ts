import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { sign, roundQty } from '../server/exchange/bybit'

describe('bybit helpers', () => {
  it('signs timestamp+key+recv+payload with HMAC-SHA256 hex', () => {
    const expected = createHmac('sha256', 's3cret').update('1700000000000' + 'KEY' + '5000' + 'category=linear').digest('hex')
    expect(sign('s3cret', '1700000000000', 'KEY', 'category=linear')).toBe(expected)
  })
  it('floors qty to the step without float noise', () => {
    expect(roundQty(0.025, 0.001)).toBe('0.025')
    expect(roundQty(0.0257, 0.001)).toBe('0.025')
    expect(roundQty(15, 0.1)).toBe('15.0')
    expect(roundQty(0.3 * 0.5, 0.01)).toBe('0.15')
  })
})

import { vi, afterEach } from 'vitest'
import { BybitExchange } from '../server/exchange/bybit'

describe('BybitExchange requests (mocked Bybit)', () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const raw = { symbol: 'BTCUSDT', side: 'Buy', size: '0.05', avgPrice: '60000', markPrice: '61000', liqPrice: '54300', leverage: '10', unrealisedPnl: '50', positionIM: '300', stopLoss: '', takeProfit: '0' }
  const ok = (result: unknown) => new Response(JSON.stringify({ retCode: 0, retMsg: 'OK', result }))
  afterEach(() => { vi.unstubAllGlobals(); calls.length = 0 })
  const stub = () => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/v5/position/list')) return ok({ list: [raw, { ...raw, symbol: 'ETHUSDT', size: '0', side: '' }] })
    if (url.includes('instruments-info')) return ok({ list: [{ lotSizeFilter: { qtyStep: '0.001' } }] })
    return ok({})
  }))

  it('maps open positions and drops empty ones', async () => {
    stub()
    const [p, ...rest] = await new BybitExchange('KEY', 'SECRET').positions()
    expect(rest).toHaveLength(0)
    expect(p).toMatchObject({ symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entry: 60000, mark: 61000, liq: 54300, leverage: 10, upnl: 50, sl: undefined, tp: undefined })
    expect(p.upnlPct).toBeCloseTo(16.67, 1)
    const h = calls[0].init.headers as Record<string, string>
    expect(h['X-BAPI-API-KEY']).toBe('KEY')
    expect(h['X-BAPI-SIGN']).toMatch(/^[0-9a-f]{64}$/)
    expect(calls[0].url).toContain('category=linear&settleCoin=USDT')
  })

  it('close 50% sends a reduce-only market order on the opposite side, qty rounded to the step', async () => {
    stub()
    await new BybitExchange('KEY', 'SECRET').close('BTCUSDT', 0.5)
    const order = calls.find(c => c.url.endsWith('/v5/order/create'))!
    expect(JSON.parse(order.init.body as string)).toEqual({ category: 'linear', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.025', reduceOnly: true, positionIdx: 0 })
  })

  it('stop uses trading-stop with an integer positionIdx', async () => {
    stub()
    await new BybitExchange('KEY', 'SECRET').setStop('BTCUSDT', 60000)
    const call = calls.find(c => c.url.endsWith('/v5/position/trading-stop'))!
    expect(JSON.parse(call.init.body as string)).toEqual({ category: 'linear', symbol: 'BTCUSDT', stopLoss: '60000', tpslMode: 'Full', positionIdx: 0 })
  })

  it('surfaces Bybit errors as readable messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ retCode: 10003, retMsg: 'API key is invalid.', result: {} }))))
    await expect(new BybitExchange('KEY', 'SECRET').positions()).rejects.toThrow('Bybit: API key is invalid.')
  })
})
