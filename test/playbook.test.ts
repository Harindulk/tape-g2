import { describe, it, expect } from 'vitest'
import { rankActions } from '../server/playbook'
import type { Position } from '../server/exchange/types'

const base: Position = { symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entry: 60000, mark: 60300, liq: 54300, leverage: 10, upnl: 15, upnlPct: 5 }

describe('rankActions', () => {
  it('always returns exactly 3 actions with short labels', () => {
    for (const p of [base, { ...base, mark: 55000, liq: 54300 }, { ...base, upnlPct: -2 }]) {
      const a = rankActions(p)
      expect(a).toHaveLength(3)
      for (const x of a) expect(x.label.length).toBeLessThanOrEqual(28)
    }
  })
  it('near liquidation puts Close 50% first', () => {
    const a = rankActions({ ...base, mark: 56000, liq: 54300 }) // ~3% away
    expect(a[0].command).toEqual({ kind: 'close', symbol: 'BTCUSDT', fraction: 0.5 })
  })
  it('in profit with no stop puts stop-to-breakeven first', () => {
    expect(rankActions(base)[0].command).toEqual({ kind: 'stop', symbol: 'BTCUSDT', price: 'breakeven' })
  })
  it('in profit with a stop already: take profit +2% first (short side mirrors)', () => {
    expect(rankActions({ ...base, sl: 60000 })[0].command).toEqual({ kind: 'tp', symbol: 'BTCUSDT', price: 61506 })
    const short: Position = { ...base, side: 'Sell', sl: 60000, mark: 59700, liq: 65700 }
    expect(rankActions(short)[0].command).toEqual({ kind: 'tp', symbol: 'BTCUSDT', price: 58506 })
  })
  it('losing position: stop at -1R style offers close half first', () => {
    const a = rankActions({ ...base, upnlPct: -4, mark: 59500 })
    expect(a[0].command.kind).toBe('close')
  })
})
