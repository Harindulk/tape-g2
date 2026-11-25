import { describe, it, expect } from 'vitest'
import { cardScreen, actionScreen, confirmScreen, resultScreen, riskScreen, emptyScreen, listeningScreen, alertScreen, errorScreen, SAFE } from '../src/glass/screens'
import type { PositionView } from '../src/types'

const pos: PositionView = {
  symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entry: 58520, mark: 59964.5, liq: 52960, leverage: 10, upnl: 72.2, upnlPct: 24.7,
  liqPct: 11.7, history: [59000, 59500, 59964], actions: [
    { label: 'Stop to breakeven', command: { kind: 'stop', symbol: 'BTCUSDT', price: 'breakeven' } },
    { label: 'Take profit 61,164', command: { kind: 'tp', symbol: 'BTCUSDT', price: 61164 } },
    { label: 'Close 50%', command: { kind: 'close', symbol: 'BTCUSDT', fraction: 0.5 } },
  ],
}

const all = () => [
  cardScreen(pos, 0, 3, 1),
  actionScreen(pos, 0),
  confirmScreen('Close 50% of ETH short', 'close half of eth'),
  resultScreen('Closed 50% ETH  +$15.17 realised', true),
  riskScreen({ ...pos, liqPct: 3.2 }),
  emptyScreen(),
  listeningScreen(),
  alertScreen({ id: 1, symbol: 'BTCUSDT', op: '<', price: 58000 }, 57990),
  errorScreen('Bybit: insufficient balance'),
]

describe('glasses screens', () => {
  it('stay within firmware limits and safe glyphs', () => {
    for (const s of all()) {
      for (const [name, text] of Object.entries(s.texts)) {
        expect(text.length, name).toBeLessThanOrEqual(1000)
        expect(text.split('\n').length, name).toBeLessThanOrEqual(10)
        expect(SAFE.test(text), `${name}: ${text}`).toBe(true)
      }
    }
  })
  it('card shows coin, side, pnl, liq distance and the one-tap default', () => {
    const s = cardScreen(pos, 0, 3, 1)
    expect(s.layout).toBe('card')
    expect(s.texts.head).toContain('BTC LONG 10x')
    expect(s.texts.head).toContain('1/3')
    expect(s.texts.body).toContain('+$72.20')
    expect(s.texts.body).toContain('+24.7%')
    expect(s.texts.body).toContain('11.7%')
    expect(s.texts.foot).toContain('Stop to breakeven')
  })
  it('action screen marks the selected action and shows 1/3 paging', () => {
    const s = actionScreen(pos, 1)
    expect(s.texts.main).toContain('> Take profit 61,164')
    expect(s.texts.main).toContain('  Stop to breakeven')
  })
  it('stale data is flagged on the card', () => {
    expect(cardScreen(pos, 0, 1, 15).texts.head).toContain('STALE')
  })
})
