import type { State } from './types'
import type { Screen } from './glass/screens'

interface Hooks { onCommandText: (t: string) => void; onNudge: (symbol: string, pct: number) => void }

let els: Record<string, HTMLElement> = {}

export function mountPhone(h: Hooks) {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <main>
      <header><h1>Tape</h1><span id="mode"></span></header>
      <section id="mirror" aria-label="What the glasses show"></section>
      <form id="cmd"><input name="t" placeholder='Type a command, e.g. "close half of ETH"' autocomplete="off"><button>Send</button></form>
      <section id="positions"></section>
      <section id="demo"><span>Demo market moves</span>
        <button data-s="SOLUSDT" data-p="-3">SOL -3%</button><button data-s="BTCUSDT" data-p="1">BTC +1%</button><button data-s="ETHUSDT" data-p="2">ETH +2%</button></section>
      <ol id="log"></ol>
    </main>`
  for (const id of ['mode', 'mirror', 'positions', 'log', 'demo']) els[id] = app.querySelector('#' + id)!
  app.querySelector<HTMLFormElement>('#cmd')!.addEventListener('submit', e => {
    e.preventDefault()
    const input = (e.target as HTMLFormElement).elements.namedItem('t') as HTMLInputElement
    if (input.value.trim()) h.onCommandText(input.value.trim())
    input.value = ''
  })
  els.demo.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button')
    if (b) h.onNudge(b.dataset.s!, Number(b.dataset.p))
  })
}

export const phone = {
  mirror(s: Screen) {
    if (!els.mirror) return
    els.mirror.className = s.layout
    els.mirror.innerHTML = Object.keys(s.texts).map(k => `<pre class="${k}"></pre>`).join('')
    Object.values(s.texts).forEach((v, i) => ((els.mirror.children[i] as HTMLElement).textContent = v))
  },
  state(st: State) {
    if (!els.mode) return
    els.mode.textContent = st.exchange === 'paper' ? 'Paper · live Bybit prices' : 'Bybit testnet'
    els.demo.hidden = st.exchange !== 'paper'
    els.positions.textContent = `${st.positions.length} open · ${st.alerts.length} alerts armed`
  },
  log(line: string) {
    if (!els.log) return
    const li = document.createElement('li')
    li.textContent = line
    els.log.prepend(li)
  },
}
