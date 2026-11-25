export const coin = (symbol: string) => symbol.replace(/USDT$/, '')

export function price(p: number): string {
  return p >= 1000 ? Math.round(p).toLocaleString('en-US') : p >= 100 ? p.toFixed(1) : String(Number(p.toFixed(3)))
}

export function money(v: number): string {
  const s = Math.abs(v) >= 1000 ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(2)
  return `${v < 0 ? '-' : '+'}$${s}`
}

export const pct = (v: number) => `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(1)}%`

/** Text bar for liquidation distance: █ = room left (≥25% = full), ─ = used up. */
export function liqBar(distPct: number, cells = 8): string {
  const n = Math.max(0, Math.min(cells, Math.round((distPct / 25) * cells)))
  return '█'.repeat(n) + '▁'.repeat(cells - n)
}
