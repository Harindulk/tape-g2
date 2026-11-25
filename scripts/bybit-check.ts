// Read-only check of the Bybit testnet key in server/.env: equity and open positions. Places no orders.
import { BybitExchange } from '../server/exchange/bybit'
import { liqDistancePct } from '../server/exchange/types'

try { process.loadEnvFile(new URL('../server/.env', import.meta.url)) } catch { /* reported below */ }
const key = process.env.BYBIT_TESTNET_KEY, secret = process.env.BYBIT_TESTNET_SECRET
if (!key || !secret) {
  console.error('No key: put BYBIT_TESTNET_KEY and BYBIT_TESTNET_SECRET in server/.env')
  process.exit(1)
}
const ex = new BybitExchange(key, secret)
try {
  console.log(`Key works. Testnet equity: ${(await ex.equity()).toFixed(2)} USDT`)
  const ps = await ex.positions()
  if (!ps.length) console.log('No open USDT perpetual positions yet: open 2-3 small ones on testnet.bybit.com, then run this again.')
  for (const p of ps) console.log(`  ${p.symbol} ${p.side === 'Buy' ? 'long' : 'short'} ${p.size} @ ${p.entry}  mark ${p.mark}  pnl ${p.upnl.toFixed(2)}  liq ${liqDistancePct(p).toFixed(1)}% away`)
  console.log(ps.length ? 'Ready: npm run server will use Bybit testnet.' : '')
} catch (e) {
  console.error(`Failed: ${(e as Error).message}`)
  console.error('Check: key made on testnet.bybit.com (not bybit.com), Contracts read-write permission, one-way position mode, no IP restriction.')
  process.exit(1)
}
