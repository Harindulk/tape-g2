import { createHmac } from 'node:crypto'
import type { Exchange, Position } from './types'

const BASE = process.env.BYBIT_BASE ?? 'https://api-testnet.bybit.com'
const RECV = '5000'

/** Bybit v5 signature: HMAC_SHA256(secret, timestamp + apiKey + recvWindow + payload). */
export function sign(secret: string, ts: string, key: string, payload: string): string {
  return createHmac('sha256', secret).update(ts + key + RECV + payload).digest('hex')
}

/** Floor qty to the instrument's step, avoiding float noise. */
export function roundQty(qty: number, step: number): string {
  const decimals = (String(step).split('.')[1] ?? '').length
  return (Math.floor(qty / step + 1e-9) * step).toFixed(decimals)
}

interface RawPos {
  symbol: string; side: 'Buy' | 'Sell' | ''; size: string; avgPrice: string; markPrice: string; liqPrice: string
  leverage: string; unrealisedPnl: string; positionIM: string; stopLoss: string; takeProfit: string
}

/** Bybit testnet (USDT perpetuals). Orders are reduce-only market orders; never opens risk. */
export class BybitExchange implements Exchange {
  readonly name = 'bybit-testnet'
  private steps: Record<string, number> = {}
  constructor(private key: string, private secret: string) {}

  private async call<T>(method: 'GET' | 'POST', path: string, params: Record<string, string | boolean>): Promise<T> {
    const ts = String(Date.now())
    const query = method === 'GET' ? new URLSearchParams(params as Record<string, string>).toString() : ''
    const body = method === 'POST' ? JSON.stringify(params) : ''
    const r = await fetch(`${BASE}${path}${query ? '?' + query : ''}`, {
      method,
      headers: {
        'X-BAPI-API-KEY': this.key, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': RECV,
        'X-BAPI-SIGN': sign(this.secret, ts, this.key, method === 'GET' ? query : body),
        'content-type': 'application/json',
      },
      body: body || undefined,
      signal: AbortSignal.timeout(8000),
    })
    const j = (await r.json()) as { retCode: number; retMsg: string; result: T }
    if (j.retCode !== 0) throw new Error(`Bybit: ${j.retMsg}`)
    return j.result
  }

  async positions(): Promise<Position[]> {
    const r = await this.call<{ list: RawPos[] }>('GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' })
    return r.list
      .filter(p => Number(p.size) > 0 && p.side)
      .map(p => {
        const upnl = Number(p.unrealisedPnl)
        const im = Number(p.positionIM) || 1
        return {
          symbol: p.symbol, side: p.side as 'Buy' | 'Sell', size: Number(p.size), entry: Number(p.avgPrice),
          mark: Number(p.markPrice), liq: Number(p.liqPrice) || 0, leverage: Number(p.leverage), upnl,
          upnlPct: (upnl / im) * 100,
          sl: Number(p.stopLoss) || undefined, tp: Number(p.takeProfit) || undefined,
        }
      })
  }

  private async step(symbol: string): Promise<number> {
    if (!this.steps[symbol]) {
      const r = await this.call<{ list: Array<{ lotSizeFilter: { qtyStep: string } }> }>('GET', '/v5/market/instruments-info', { category: 'linear', symbol })
      this.steps[symbol] = Number(r.list[0]?.lotSizeFilter.qtyStep ?? 0.001)
    }
    return this.steps[symbol]
  }

  private async get(symbol: string): Promise<Position> {
    const p = (await this.positions()).find(x => x.symbol === symbol)
    if (!p) throw new Error(`No open ${symbol.replace('USDT', '')} position`)
    return p
  }

  async close(symbol: string, fraction: number): Promise<number> {
    const p = await this.get(symbol)
    const f = Math.min(1, Math.max(0, fraction))
    const qty = f >= 1 ? String(p.size) : roundQty(p.size * f, await this.step(symbol))
    if (Number(qty) <= 0) throw new Error('Position too small to split')
    await this.call('POST', '/v5/order/create', {
      category: 'linear', symbol, side: p.side === 'Buy' ? 'Sell' : 'Buy', orderType: 'Market', qty, reduceOnly: true, positionIdx: '0',
    } as unknown as Record<string, string>)
    return (p.upnl * Number(qty)) / p.size // estimate at last mark; fills may differ slightly
  }

  async setStop(symbol: string, price: number) {
    await this.call('POST', '/v5/position/trading-stop', { category: 'linear', symbol, stopLoss: String(price), tpslMode: 'Full', positionIdx: '0' } as unknown as Record<string, string>)
  }

  async setTakeProfit(symbol: string, price: number) {
    await this.call('POST', '/v5/position/trading-stop', { category: 'linear', symbol, takeProfit: String(price), tpslMode: 'Full', positionIdx: '0' } as unknown as Record<string, string>)
  }
}
