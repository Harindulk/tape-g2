import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { sign, roundQty } from '../server/exchange/bybit'

describe('bybit helpers', () => {
  it('signs timestamp+key+recv+payload with HMAC-SHA256 hex', () => {
    const expected = createHmac('sha256', 's3cret').update('1700000000000' + 'KEY' + '5000' + 'category=linear').digest('hex')
    expect(sign('s3cret', '1700000000000', 'KEY', 'category=linear')).toBe(expected)
  })
  it('floors qty to the step without float noise', () => {
    expect(roundQty(0.025, 0.001)).toBe('0.025')
    expect(roundQty(0.0257, 0.001)).toBe('0.025')
    expect(roundQty(15, 0.1)).toBe('15.0')
    expect(roundQty(0.3 * 0.5, 0.01)).toBe('0.15')
  })
})
