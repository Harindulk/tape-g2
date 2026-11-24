import { describe, it, expect } from 'vitest'
import { parseCommand } from '../server/parse'

const open = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
const p = (t: string, syms = open) => parseCommand(t, syms)

describe('parseCommand', () => {
  it('close with fractions', () => {
    expect(p('close half of eth')).toEqual({ kind: 'close', symbol: 'ETHUSDT', fraction: 0.5 })
    expect(p('Close all bitcoin.')).toEqual({ kind: 'close', symbol: 'BTCUSDT', fraction: 1 })
    expect(p('take off a quarter of sol')).toEqual({ kind: 'close', symbol: 'SOLUSDT', fraction: 0.25 })
    expect(p('close 30% ether')).toEqual({ kind: 'close', symbol: 'ETHUSDT', fraction: 0.3 })
    expect(p('close sol')).toEqual({ kind: 'close', symbol: 'SOLUSDT', fraction: 1 })
    expect(p('cut half of solana')).toEqual({ kind: 'close', symbol: 'SOLUSDT', fraction: 0.5 })
  })
  it('stops', () => {
    expect(p('move stop to breakeven on btc')).toEqual({ kind: 'stop', symbol: 'BTCUSDT', price: 'breakeven' })
    expect(p('stop loss bitcoin at 58k')).toEqual({ kind: 'stop', symbol: 'BTCUSDT', price: 58000 })
    expect(p('set stop on eth at 3,150')).toEqual({ kind: 'stop', symbol: 'ETHUSDT', price: 3150 })
  })
  it('take profit', () => {
    expect(p('take profit eth at 2900')).toEqual({ kind: 'tp', symbol: 'ETHUSDT', price: 2900 })
    expect(p('target 64.5k on bitcoin')).toEqual({ kind: 'tp', symbol: 'BTCUSDT', price: 64500 })
  })
  it('alerts', () => {
    expect(p('alert me if btc drops below 58k')).toEqual({ kind: 'alert', symbol: 'BTCUSDT', op: '<', price: 58000 })
    expect(p('tell me when sol goes above 160')).toEqual({ kind: 'alert', symbol: 'SOLUSDT', op: '>', price: 160 })
  })
  it('defaults to the only open position when no coin is named', () => {
    expect(p('close half', ['ETHUSDT'])).toEqual({ kind: 'close', symbol: 'ETHUSDT', fraction: 0.5 })
  })
  it('refuses when ambiguous, unknown or not open', () => {
    expect(p('close half')).toEqual({ kind: 'unknown', text: 'close half', reason: 'Which coin?' })
    expect(p('close doge').kind).toBe('unknown')
    expect(p('what is the weather').kind).toBe('unknown')
    expect(p('').kind).toBe('unknown')
  })
})
