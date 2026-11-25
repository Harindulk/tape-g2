import { createServer } from 'node:http'
import { PaperExchange, bybitMarks, bybitCandles } from './exchange/paper'
import { BybitExchange } from './exchange/bybit'
import { createApp } from './app'
import { transcribe, sttReady, startWhisper } from './stt'
import { llmEnabled } from './llm'

const PORT = Number(process.env.PORT ?? 8787)
const key = process.env.BYBIT_TESTNET_KEY
const secret = process.env.BYBIT_TESTNET_SECRET

const paper = new PaperExchange(bybitMarks)
const exchange = key && secret ? new BybitExchange(key, secret) : paper
const handler = createApp({
  exchange,
  // Paper charts use live mainnet candles; testnet uses its own (different) prices.
  candles: s => bybitCandles(s, 30, exchange === paper ? undefined : 'https://api-testnet.bybit.com').then(c => exchange === paper ? c.map(v => v * (1 + (paper.drift[s] ?? 0))) : c),
  transcribe: sttReady() ? transcribe : undefined,
  nudge: exchange === paper ? (s, pct) => { paper.drift[s] = (paper.drift[s] ?? 0) + pct / 100 } : undefined,
})

startWhisper()
createServer(handler).listen(PORT, () => {
  console.log(`Tape server on http://localhost:${PORT}  exchange=${exchange.name}  stt=${sttReady() ? 'whisper.cpp' : 'off'}  llm=${llmEnabled() ? 'on' : 'off'}`)
})
