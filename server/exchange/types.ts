export type Side = 'Buy' | 'Sell'

export interface Position {
  symbol: string // e.g. BTCUSDT
  side: Side
  size: number
  entry: number
  mark: number
  liq: number
  leverage: number
  upnl: number
  upnlPct: number // return on margin, %
  sl?: number
  tp?: number
}

export interface Exchange {
  readonly name: string
  positions(): Promise<Position[]>
  /** Reduce a position by `fraction` (0..1] at market. Returns realised PnL in USDT. */
  close(symbol: string, fraction: number): Promise<number>
  setStop(symbol: string, price: number): Promise<void>
  setTakeProfit(symbol: string, price: number): Promise<void>
  /** Paper only: symbols force-closed since the last call. */
  takeLiquidations?(): string[]
}

/** Percent move in price from mark to liq (always positive while not liquidated). */
export function liqDistancePct(p: Pick<Position, 'mark' | 'liq'>): number {
  if (!p.liq) return Infinity
  return (Math.abs(p.mark - p.liq) / p.mark) * 100
}

export function pnlOf(side: Side, size: number, entry: number, price: number): number {
  return (side === 'Buy' ? price - entry : entry - price) * size
}

/** Simple isolated-margin liquidation estimate (0.5% maintenance margin). */
export function estimateLiq(side: Side, entry: number, leverage: number): number {
  const mm = 0.005
  return side === 'Buy' ? entry * (1 - 1 / leverage + mm) : entry * (1 + 1 / leverage - mm)
}
