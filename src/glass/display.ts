import {
  type EvenAppBridge, CreateStartUpPageContainer, RebuildPageContainer, TextContainerProperty,
  ImageContainerProperty, TextContainerUpgrade, ImageRawDataUpdate,
} from '@evenrealities/even_hub_sdk'
import type { Layout, Screen } from './screens'

const W = 576, H = 288

type Box = { id: number; x: number; y: number; w: number; h: number; capture?: boolean; border?: boolean }
const LAYOUTS: Record<Layout, { texts: Record<string, Box>; chart?: Box }> = {
  card: {
    texts: {
      head: { id: 1, x: 0, y: 0, w: 300, h: 40 },
      body: { id: 2, x: 0, y: 40, w: 300, h: 150 },
      foot: { id: 3, x: 0, y: 200, w: W, h: 88, capture: true, border: true },
    },
    chart: { id: 4, x: 288, y: 36, w: 288, h: 144 },
  },
  full: { texts: { main: { id: 1, x: 0, y: 0, w: W, h: H, capture: true, border: true } } },
}

/**
 * Owns the glasses page. Rebuilds only when the layout changes, otherwise does
 * flicker-free in-place text updates, and only for containers whose text changed.
 */
export class Display {
  private layout: Layout | null = null
  private shown: Record<string, string> = {}
  private started = false
  private queue = Promise.resolve()
  /** Last text sent per container, for the phone mirror. */
  onShow?: (s: Screen) => void

  constructor(private bridge: EvenAppBridge) {}

  show(s: Screen, chartPng?: () => Promise<Uint8Array | null>): Promise<void> {
    // Serialise every bridge call: the BLE queue drops overlapping sends.
    this.queue = this.queue.then(() => this.apply(s, chartPng)).catch(e => console.warn('display', e))
    this.onShow?.(s)
    return this.queue
  }

  private async apply(s: Screen, chartPng?: () => Promise<Uint8Array | null>) {
    const spec = LAYOUTS[s.layout]
    if (s.layout !== this.layout) {
      const textObject = Object.entries(spec.texts).map(([name, b]) => new TextContainerProperty({
        xPosition: b.x, yPosition: b.y, width: b.w, height: b.h, containerID: b.id, containerName: name,
        content: s.texts[name] ?? ' ', isEventCapture: b.capture ? 1 : 0,
        borderWidth: b.border ? 1 : 0, borderColor: 6, borderRadius: 6, paddingLength: 6,
      }))
      const imageObject = spec.chart
        ? [new ImageContainerProperty({ xPosition: spec.chart.x, yPosition: spec.chart.y, width: spec.chart.w, height: spec.chart.h, containerID: spec.chart.id, containerName: 'chart' })]
        : undefined
      const page = { containerTotalNum: textObject.length + (imageObject?.length ?? 0), textObject, imageObject }
      if (!this.started) {
        await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
        this.started = true
      } else {
        await this.bridge.rebuildPageContainer(new RebuildPageContainer(page))
      }
      this.layout = s.layout
      this.shown = { ...s.texts }
    } else {
      for (const [name, b] of Object.entries(spec.texts)) {
        const text = s.texts[name] ?? ' '
        if (this.shown[name] === text) continue
        await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: b.id, containerName: name, content: text }))
        this.shown[name] = text
      }
    }
    if (spec.chart && chartPng) {
      const png = await chartPng()
      if (png) await this.bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: spec.chart.id, containerName: 'chart', imageData: png }))
    }
  }

  /** Force the next show() to rebuild (e.g. after the system exit dialog cleared the page). */
  invalidate() { this.layout = null; this.shown = {} }
}
