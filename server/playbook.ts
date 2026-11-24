import type { Command } from './parse'
import { type Position, liqDistancePct } from './exchange/types'

export interface Action { label: string; command: Command }

/** Liq distance (%) under which the app takes over the screen and leads with de-risking. */
export const RISK_PCT = 5
const NEAR_LIQ_PCT = 8
const TP_MOVE = 0.02

/** Round to a price step that reads well on a glance. */
export function tidy(price: number): number {
  const step = price >= 10000 ? 1 : price >= 100 ? 0.1 : 0.001
  return Math.round(price / step) * step
}

/**
 * The user's playbook: three one-tap actions in priority order. These are risk-management
 * shortcuts the trader chose, not trade recommendations.
 */
export function rankActions(p: Position): Action[] {
  const s = p.symbol
  const half: Action = { label: 'Close 50%', command: { kind: 'close', symbol: s, fraction: 0.5 } }
  const all: Action = { label: 'Close all', command: { kind: 'close', symbol: s, fraction: 1 } }
  const be: Action = { label: 'Stop to breakeven', command: { kind: 'stop', symbol: s, price: 'breakeven' } }
  const tpPrice = tidy(p.side === 'Buy' ? p.mark * (1 + TP_MOVE) : p.mark * (1 - TP_MOVE))
  const tp: Action = { label: `Take profit ${fmt(tpPrice)}`, command: { kind: 'tp', symbol: s, price: tpPrice } }

  if (liqDistancePct(p) < NEAR_LIQ_PCT) return [half, all, be]
  if (p.upnlPct > 0) return p.sl === undefined ? [be, tp, half] : [tp, half, all]
  return [half, all, tp]
}

export function fmt(price: number): string {
  return price >= 1000 ? Math.round(price).toLocaleString('en-US') : price >= 100 ? price.toFixed(1) : price.toFixed(3)
}
