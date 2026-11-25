import type { PositionView, Alert } from '../types'
import { coin, price, money, pct, liqBar } from './format'

/** 'card' = text left + price chart right + footer; 'full' = one bordered full-screen text. */
export type Layout = 'card' | 'full'
export interface Screen { layout: Layout; texts: Record<string, string> }

/** Printable ASCII plus the glyphs the G2 firmware font is known to draw. */
export const SAFE = /^[\x20-\x7E\n█━─▲▼●○▁▂▃▄▅▆▇│]*$/

const sideOf = (p: PositionView) => `${coin(p.symbol)} ${p.side === 'Buy' ? 'LONG' : 'SHORT'} ${p.leverage}x`
const full = (main: string): Screen => ({ layout: 'full', texts: { main } })

export function cardScreen(p: PositionView, index: number, total: number, ageSec: number): Screen {
  const stale = ageSec > 10 ? '  STALE' : ''
  return {
    layout: 'card',
    texts: {
      head: `${sideOf(p)}   ${index + 1}/${total}${stale}`,
      body: [
        `${money(p.upnl)}   ${pct(p.upnlPct)}`,
        `Mark ${price(p.mark)}`,
        `Entry ${price(p.entry)}${p.sl ? `  SL ${price(p.sl)}` : ''}`,
        `Liq ${p.liqPct.toFixed(1)}% ${liqBar(p.liqPct)}`,
      ].join('\n'),
      foot: `tap   ${p.actions[0]?.label ?? 'actions'}\nhold  speak        swipe  next`,
    },
  }
}

export function actionScreen(p: PositionView, selected: number): Screen {
  const rows = p.actions.map((a, i) => `${i === selected ? '>' : ' '} ${a.label}`)
  return full([`${sideOf(p)}   ${money(p.upnl)}`, '', ...rows, '', 'tap  do it   swipe  change   2x  back'].join('\n'))
}

export function confirmScreen(summary: string, heard?: string): Screen {
  const top = heard ? [`Heard: "${heard.slice(0, 60)}"`, ''] : []
  return full([...top, `${summary}?`, '', 'tap  yes        2x tap  no'].join('\n'))
}

export function resultScreen(message: string, ok: boolean): Screen {
  // Server messages use a double space between the what and the money: put each on its own line.
  return full([ok ? '● Done' : '○ Not done', '', ...message.split(/\s{2,}|\n/)].join('\n'))
}

export function riskScreen(p: PositionView): Screen {
  return full([
    `▲ RISK   ${sideOf(p)}`,
    `Liquidation ${p.liqPct.toFixed(1)}% away`,
    `Mark ${price(p.mark)}   Liq ${price(p.liq)}`,
    `PnL ${money(p.upnl)}`,
    '',
    `tap  ${p.actions[0]?.label ?? 'Close 50%'}`,
    'swipe  not now',
  ].join('\n'))
}

export function alertScreen(a: Alert, mark?: number): Screen {
  return full([
    `▲ ALERT   ${coin(a.symbol)} ${a.op === '<' ? 'below' : 'above'} ${price(a.price)}`,
    mark !== undefined ? `Mark ${price(mark)}` : '',
    '',
    'tap  ok',
  ].join('\n'))
}

export const listeningScreen = () => full(['● Listening', '', 'Try "close half of ETH"', 'or "stop to breakeven on BTC"', '', 'release to send'].join('\n'))
export const thinkingScreen = () => full('Working...')
export const emptyScreen = () => full(['Flat.', 'No open positions.', '', 'hold  speak'].join('\n'))
export const errorScreen = (msg: string) => full(['Can\'t reach the market', '', msg.slice(0, 120), '', 'Retrying...'].join('\n'))
