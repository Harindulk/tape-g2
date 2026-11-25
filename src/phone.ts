import type { State } from './types'
import type { Screen } from './glass/screens'
import { coin, money, price, pct } from './glass/format'
import { drawChart } from './glass/chart'

interface Hooks {
  onCommandText: (t: string) => void
  onNudge: (symbol: string, pct: number) => void
  onSelect: (index: number) => void
  onReset: () => void
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

export function mountPhone(h: Hooks) {
  $('#app').innerHTML = `
    <header class="bar">
      <svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 13l3-3 3 2 5-4"/></svg>
      <span class="name">Tape</span>
      <span id="mode" class="mode">Connecting</span>
    </header>
    <main>
      <section class="summary" aria-live="polite">
        <h1 id="finding">Loading positions</h1>
        <p id="total" class="total"></p>
      </section>
      <section aria-labelledby="mirror-h">
        <h2 id="mirror-h">On your glasses</h2>
        <div id="mirror" class="mirror" data-ui role="img" aria-label="Glasses display mirror"></div>
        <p class="hint">Tap the temple or ring to act. Hold to speak. Swipe for the next position.</p>
      </section>
      <section aria-labelledby="pos-h">
        <h2 id="pos-h">Positions</h2>
        <ul id="positions" class="rows"></ul>
      </section>
      <section aria-labelledby="cmd-h">
        <h2 id="cmd-h">Command</h2>
        <form id="cmd" class="cmd">
          <input id="cmd-input" name="t" aria-labelledby="cmd-h" placeholder="close half of ETH" autocomplete="off" enterkeyhint="send">
          <button type="submit">Send</button>
        </form>
        <p class="hint">Same words work by voice: "stop to breakeven on BTC", "alert me if SOL drops below 65".</p>
      </section>
      <section id="demo" aria-labelledby="demo-h" hidden>
        <h2 id="demo-h">Move the paper market</h2>
        <div class="chips">
          <button data-s="SOLUSDT" data-p="-3">SOL −3%</button>
          <button data-s="BTCUSDT" data-p="1">BTC +1%</button>
          <button data-s="ETHUSDT" data-p="2">ETH +2%</button>
          <button data-reset>Reset account</button>
        </div>
      </section>
      <section aria-labelledby="log-h">
        <h2 id="log-h">Activity</h2>
        <ol id="log" class="log"><li class="empty">Nothing yet. Actions you take show here.</li></ol>
      </section>
      <footer>Testnet and paper trading only. Tape never holds funds and gives no advice.</footer>
    </main>`
  $('#cmd').addEventListener('submit', e => {
    e.preventDefault()
    const input = $<HTMLInputElement>('#cmd-input')
    if (input.value.trim()) h.onCommandText(input.value.trim())
    input.value = ''
  })
  $('#demo').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button')
    if (b?.hasAttribute('data-reset')) h.onReset()
    else if (b) h.onNudge(b.dataset.s!, Number(b.dataset.p))
  })
  $('#positions').addEventListener('click', e => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
    if (li) h.onSelect(Number(li.dataset.i))
  })
}

let selected = 0

export const phone = {
  mirror(s: Screen, chartFor?: Parameters<typeof drawChart>[0]) {
    const m = document.querySelector<HTMLElement>('#mirror')
    if (!m) return
    m.className = `mirror ${s.layout}`
    m.replaceChildren(...Object.entries(s.texts).map(([k, v]) => {
      const pre = document.createElement('pre')
      pre.className = k
      pre.textContent = v
      return pre
    }))
    if (s.layout === 'card' && chartFor) m.append(Object.assign(drawChart(chartFor), { className: 'chart' }))
  },

  select(i: number) { selected = i; document.querySelectorAll('#positions li').forEach((li, j) => li.classList.toggle('on', j === i)) },

  state(st: State) {
    const mode = document.querySelector('#mode')
    if (!mode) return
    mode.textContent = st.exchange === 'paper' ? 'Paper · live Bybit prices' : 'Bybit testnet'
    $('#demo').hidden = st.exchange !== 'paper'

    const ps = st.positions
    const total = ps.reduce((n, p) => n + p.upnl, 0)
    const nearest = [...ps].sort((a, b) => a.liqPct - b.liqPct)[0]
    $('#finding').textContent = !ps.length
      ? 'Flat. No open positions.'
      : st.risk
        ? `${coin(st.risk)} is ${nearest.liqPct.toFixed(1)}% from liquidation`
        : `Nearest liquidation: ${coin(nearest.symbol)}, ${nearest.liqPct.toFixed(1)}% away`
    $('#finding').classList.toggle('risk', Boolean(st.risk))
    const t = $('#total')
    t.innerHTML = ps.length ? `<span class="${total >= 0 ? 'up' : 'down'}">${money(total)}</span> open P&amp;L across ${ps.length} position${ps.length > 1 ? 's' : ''}${st.alerts.length ? ` · ${st.alerts.length} alert${st.alerts.length > 1 ? 's' : ''} armed` : ''}` : ''

    $('#positions').innerHTML = ps.length
      ? ps.map((p, i) => `
        <li data-i="${i}" class="${i === selected ? 'on' : ''}${p.liqPct < 5 ? ' at-risk' : ''}" tabindex="0" role="button" aria-label="Show ${coin(p.symbol)} on glasses">
          <span class="id">${coin(p.symbol)} ${p.side === 'Buy' ? 'long' : 'short'} ${p.leverage}x</span>
          <span class="num ${p.upnl >= 0 ? 'up' : 'down'}">${money(p.upnl)}</span>
          <span class="sub">${p.size} @ ${price(p.entry)} · mark ${price(p.mark)}${p.sl ? ` · stop ${price(p.sl)}` : ''}</span>
          <span class="sub num">${pct(p.upnlPct)} · liq ${p.liqPct.toFixed(1)}%</span>
        </li>`).join('')
      : '<li class="empty">No open positions.</li>'
  },

  error(msg: string) {
    const f = document.querySelector('#finding')
    if (!f) return
    f.textContent = "Can't reach the Tape server"
    f.classList.add('risk')
    $('#total').textContent = `${msg}. Is npm run server running? Retrying every 2 s.`
  },

  log(line: string) {
    const log = document.querySelector('#log')
    if (!log) return
    log.querySelector('.empty')?.remove()
    const li = document.createElement('li')
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    li.innerHTML = `<time>${time}</time> ${esc(line)}`
    log.prepend(li)
    while (log.children.length > 8) log.lastElementChild!.remove()
  },
}
