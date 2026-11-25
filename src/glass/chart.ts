import type { PositionView } from '../types'

const W = 288, H = 144

/**
 * Price line for the last ~60 s with entry (dashed) and stop lines. Drawn in greys:
 * the glasses map brightness to 16 levels of green.
 */
export function drawChart(p: PositionView, canvas = document.createElement('canvas')): HTMLCanvasElement {
  canvas.width = W; canvas.height = H
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
  const pts = p.history.length > 1 ? p.history : [p.mark, p.mark]
  const refs = [p.entry, ...(p.sl ? [p.sl] : [])]
  let lo = Math.min(...pts), hi = Math.max(...pts)
  // Keep entry in view when it's close; otherwise show it as an arrow at the edge.
  const span = Math.max(hi - lo, p.mark * 0.002)
  for (const r of refs) if (Math.abs(r - p.mark) < span * 3) { lo = Math.min(lo, r); hi = Math.max(hi, r) }
  const pad = (hi - lo || span) * 0.12
  lo -= pad; hi += pad
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12)
  const x = (i: number) => 4 + (i / (pts.length - 1)) * (W - 8)

  // Entry line
  g.strokeStyle = '#777'; g.lineWidth = 2; g.setLineDash([6, 6])
  const ey = Math.max(4, Math.min(H - 4, y(p.entry)))
  g.beginPath(); g.moveTo(0, ey); g.lineTo(W, ey); g.stroke()
  g.setLineDash([])
  g.fillStyle = '#999'; g.font = 'bold 16px sans-serif'; g.fillText('entry', 4, ey > 24 ? ey - 6 : ey + 18)
  g.fillText('30m', W - 34, 16)

  // Price line
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.lineJoin = 'round'
  g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); g.stroke()
  // Last-price dot
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x(pts.length - 1), y(pts[pts.length - 1]), 5, 0, Math.PI * 2); g.fill()
  return canvas
}

export async function chartPng(p: PositionView): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>(r => drawChart(p).toBlob(r, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}
