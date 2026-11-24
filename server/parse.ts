export type Command =
  | { kind: 'close'; symbol: string; fraction: number }
  | { kind: 'stop'; symbol: string; price: number | 'breakeven' }
  | { kind: 'tp'; symbol: string; price: number }
  | { kind: 'alert'; symbol: string; op: '<' | '>'; price: number }
  | { kind: 'unknown'; text: string; reason?: string }

const COINS: Record<string, string> = {
  btc: 'BTC', bitcoin: 'BTC', eth: 'ETH', ether: 'ETH', ethereum: 'ETH', sol: 'SOL', solana: 'SOL',
  doge: 'DOGE', dogecoin: 'DOGE', xrp: 'XRP', ripple: 'XRP', bnb: 'BNB', avax: 'AVAX', link: 'LINK',
}

/** "58k" → 58000, "3,150" → 3150, "64.5k" → 64500 */
function num(s: string): number {
  const m = s.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(k)?$/)
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : NaN
}
const PRICE = String.raw`(\d[\d,]*(?:\.\d+)?k?)`

/** Rule-based parser for short spoken commands. Never guesses: anything unclear → unknown. */
export function parseCommand(raw: string, openSymbols: string[]): Command {
  const text = raw.toLowerCase().replace(/[!?]|\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim()
  const unknown = (reason?: string): Command => ({ kind: 'unknown', text: raw.trim(), ...(reason ? { reason } : {}) })
  if (!text) return unknown()

  const named = text.split(' ').map(w => COINS[w]).find(Boolean)
  let symbol: string
  if (named) {
    symbol = named + 'USDT'
    if (!openSymbols.includes(symbol)) return unknown(`No open ${named} position`)
  } else if (openSymbols.length === 1) symbol = openSymbols[0]
  else symbol = ''

  const need = (c: Command): Command => (symbol ? c : unknown('Which coin?'))

  const alert = text.match(new RegExp(`(?:alert|tell|ping|warn|notify).*?(below|under|above|over)\\s+${PRICE}`))
  if (alert) return need({ kind: 'alert', symbol, op: /below|under/.test(alert[1]) ? '<' : '>', price: num(alert[2]) })

  if (/\b(stop|sl)\b/.test(text)) {
    if (/break ?even|\bbe\b/.test(text)) return need({ kind: 'stop', symbol, price: 'breakeven' })
    const m = text.match(new RegExp(`(?:at|to)\\s+${PRICE}`))
    if (m && !Number.isNaN(num(m[1]))) return need({ kind: 'stop', symbol, price: num(m[1]) })
    return unknown('Stop at what price?')
  }

  if (/take profit|\btp\b|target/.test(text)) {
    const m = text.match(new RegExp(`(?:at|to)\\s+${PRICE}`)) ?? text.match(new RegExp(`target\\s+${PRICE}`))
    if (m && !Number.isNaN(num(m[1]))) return need({ kind: 'tp', symbol, price: num(m[1]) })
    return unknown('Target at what price?')
  }

  if (/\b(close|cut|take off|trim|exit|reduce|flatten)\b/.test(text)) {
    let fraction = 1
    const pct = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/)
    if (pct) fraction = Number(pct[1]) / 100
    else if (/\bhalf\b/.test(text)) fraction = 0.5
    else if (/\bquarter\b/.test(text)) fraction = 0.25
    else if (/\bthird\b/.test(text)) fraction = 1 / 3
    if (!(fraction > 0 && fraction <= 1)) return unknown('Close how much?')
    return need({ kind: 'close', symbol, fraction })
  }

  return unknown()
}
