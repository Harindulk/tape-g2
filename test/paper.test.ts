import { describe, it, expect } from 'vitest'
import { PaperExchange } from '../server/exchange/paper'
import { liqDistancePct, estimateLiq } from '../server/exchange/types'

const prices = { BTCUSDT: 60000, ETHUSDT: 3000, SOLUSDT: 150 }
const feed = async (syms: string[]) => Object.fromEntries(syms.map(s => [s, prices[s as keyof typeof prices]]))

describe('paper exchange', () => {
  it('seeds three positions around the live mark', async () => {
    const ex = new PaperExchange(feed)
    const ps = await ex.positions()
    expect(ps.map(p => p.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
    const btc = ps[0]
    expect(btc.side).toBe('Buy')
    expect(btc.upnl).toBeGreaterThan(0) // entered 2.5% below mark
    expect(btc.liq).toBeCloseTo(estimateLiq('Buy', btc.entry, btc.leverage))
  })

  it('close 0.5 halves size and realises half the pnl', async () => {
    const ex = new PaperExchange(feed)
    const before = (await ex.positions())[0]
    const realised = await ex.close('BTCUSDT', 0.5)
    const after = (await ex.positions())[0]
    expect(after.size).toBeCloseTo(before.size / 2)
    expect(realised).toBeCloseTo(before.upnl / 2)
  })

  it('close 1 removes the position', async () => {
    const ex = new PaperExchange(feed)
    await ex.close('ETHUSDT', 1)
    expect((await ex.positions()).map(p => p.symbol)).toEqual(['BTCUSDT', 'SOLUSDT'])
  })

  it('stores stop and take profit, rejects unknown symbols', async () => {
    const ex = new PaperExchange(feed)
    await ex.setStop('BTCUSDT', 59000)
    await ex.setTakeProfit('BTCUSDT', 62000)
    const btc = (await ex.positions())[0]
    expect(btc.sl).toBe(59000)
    expect(btc.tp).toBe(62000)
    await expect(ex.close('DOGEUSDT', 1)).rejects.toThrow(/no open DOGE/i)
  })

  it('liq distance is a positive percent', () => {
    expect(liqDistancePct({ mark: 100, liq: 90 })).toBeCloseTo(10)
    expect(liqDistancePct({ mark: 100, liq: 105 })).toBeCloseTo(5)
  })
})
