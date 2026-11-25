import { type Exchange, type Position, type Side, estimateLiq, pnlOf } from './types'

export type PriceFeed = (symbols: string[]) => Promise<Record<string, number>>

interface PaperPos { symbol: string; side: Side; size: number; entry: number; leverage: number; sl?: number; tp?: number }

// Entry offsets from the first live mark, so the demo always opens with a winner, a loser and a tight one.
const SEED: Array<Omit<PaperPos, 'entry'> & { offset: number }> = [
  { symbol: 'BTCUSDT', side: 'Buy', size: 0.05, leverage: 10, offset: -0.025 },
  { symbol: 'ETHUSDT', side: 'Sell', size: 1.2, leverage: 5, offset: 0.015 },
  { symbol: 'SOLUSDT', side: 'Buy', size: 30, leverage: 12, offset: 0.004 },
]

/** Simulated perp account priced off live Bybit marks. Keys not needed. */
export class PaperExchange implements Exchange {
  readonly name = 'paper'
  private book: PaperPos[] | null = null
  private liquidated: string[] = []
  /** Demo-only nudge (fraction) applied on top of the live price, per symbol. */
  readonly drift: Record<string, number> = {}

  constructor(private feed: PriceFeed) {}

  private async marks(): Promise<Record<string, number>> {
    const raw = await this.feed(SEED.map(s => s.symbol))
    return Object.fromEntries(Object.entries(raw).map(([s, p]) => [s, p * (1 + (this.drift[s] ?? 0))]))
  }

  private async ensureBook(marks: Record<string, number>) {
    if (!this.book) this.book = SEED.map(({ offset, ...s }) => ({ ...s, entry: marks[s.symbol] * (1 + offset) }))
    return this.book
  }

  /** Symbols liquidated since the last call (each reported once). */
  takeLiquidations(): string[] {
    const out = this.liquidated
    this.liquidated = []
    return out
  }

  /** Demo helper: fresh seed positions at the next mark, no drift. */
  reset() {
    this.book = null
    this.liquidated = []
    for (const k of Object.keys(this.drift)) delete this.drift[k]
  }

  async positions(): Promise<Position[]> {
    const marks = await this.marks()
    let book = await this.ensureBook(marks)
    // A paper position whose mark crosses its liquidation price is closed, like the exchange would.
    const gone = book.filter(p => {
      const liq = estimateLiq(p.side, p.entry, p.leverage)
      return p.side === 'Buy' ? marks[p.symbol] <= liq : marks[p.symbol] >= liq
    })
    if (gone.length) {
      this.book = book = book.filter(p => !gone.includes(p))
      this.liquidated.push(...gone.map(p => p.symbol))
    }
    return book.map(p => {
      const mark = marks[p.symbol]
      const upnl = pnlOf(p.side, p.size, p.entry, mark)
      const margin = (p.entry * p.size) / p.leverage
      return { ...p, mark, liq: estimateLiq(p.side, p.entry, p.leverage), upnl, upnlPct: (upnl / margin) * 100 }
    })
  }

  private find(symbol: string): PaperPos {
    const p = this.book?.find(b => b.symbol === symbol)
    if (!p) throw new Error(`No open ${symbol.replace('USDT', '')} position`)
    return p
  }

  async close(symbol: string, fraction: number): Promise<number> {
    const marks = await this.marks()
    await this.ensureBook(marks)
    const p = this.find(symbol)
    const f = Math.min(1, Math.max(0, fraction))
    const qty = p.size * f
    const realised = pnlOf(p.side, qty, p.entry, marks[symbol])
    p.size -= qty
    if (f >= 1 || p.size <= 1e-12) this.book = this.book!.filter(b => b !== p)
    return realised
  }

  async setStop(symbol: string, price: number) {
    await this.ensureBook(await this.marks())
    this.find(symbol).sl = price
  }

  async setTakeProfit(symbol: string, price: number) {
    await this.ensureBook(await this.marks())
    this.find(symbol).tp = price
  }
}

let cache: { at: number; marks: Record<string, number> } = { at: 0, marks: {} }

/** Live mark prices from Bybit's public v5 API (no key). Cached for 1 s; one small request per symbol. */
export const bybitMarks: PriceFeed = async symbols => {
  if (Date.now() - cache.at < 1000 && symbols.every(s => s in cache.marks)) return cache.marks
  const rows = await Promise.all(symbols.map(async s => {
    const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${s}`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) throw new Error(`Bybit tickers HTTP ${r.status}`)
    const j = (await r.json()) as { result?: { list?: Array<{ markPrice: string }> } }
    const mark = Number(j.result?.list?.[0]?.markPrice)
    if (!(mark > 0)) throw new Error(`Bybit sent no price for ${s}`)
    return [s, mark] as const
  }))
  cache = { at: Date.now(), marks: Object.fromEntries(rows) }
  return cache.marks
}

/** Last `n` one-minute closes from Bybit's public kline API (oldest first). */
export async function bybitCandles(symbol: string, n = 30, base = 'https://api.bybit.com'): Promise<number[]> {
  const r = await fetch(`${base}/v5/market/kline?category=linear&symbol=${symbol}&interval=1&limit=${n}`)
  if (!r.ok) throw new Error(`Bybit kline HTTP ${r.status}`)
  const j = (await r.json()) as { result: { list: string[][] } }
  return j.result.list.map(k => Number(k[4])).reverse()
}
