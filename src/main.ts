import { waitForEvenAppBridge, OsEventTypeList, AudioInputSource, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { api } from './api'
import type { State, Command, Alert } from './types'
import { Display } from './glass/display'
import { chartPng } from './glass/chart'
import * as S from './glass/screens'
import { mountPhone, phone } from './phone'

type View =
  | { kind: 'card' }
  | { kind: 'actions'; sel: number }
  | { kind: 'confirm'; command: Command; summary: string; heard?: string }
  | { kind: 'listening' }
  | { kind: 'thinking' }
  | { kind: 'result'; msg: string; ok: boolean }
  | { kind: 'risk'; symbol: string }
  | { kind: 'alert'; alert: Alert }

const POLL_MS = 2000
const RESULT_MS = 2500
const MAX_LISTEN_MS = 10000

let state: State | null = null
let lastOk = 0
let fetchError: string | null = null
let idx = 0
let view: View = { kind: 'card' }
let resultTimer = 0
const dismissedRisk = new Set<string>()

mountPhone({ onCommandText: text => runText(text), onNudge: (s, p) => api.nudge(s, p).then(refresh) })

const bridge = await waitForEvenAppBridge()
const display = new Display(bridge)
display.onShow = s => phone.mirror(s)

const current = () => (state?.positions.length ? state.positions[Math.min(idx, state.positions.length - 1)] : null)

function render() {
  const p = current()
  const age = (Date.now() - lastOk) / 1000
  switch (view.kind) {
    case 'card':
      if (fetchError && !state) return display.show(S.errorScreen(fetchError))
      if (!state) return display.show(S.thinkingScreen())
      if (!p) return display.show(S.emptyScreen())
      return display.show(S.cardScreen(p, idx, state.positions.length, age), () => chartPng(p))
    case 'actions': return p ? display.show(S.actionScreen(p, view.sel)) : back()
    case 'confirm': return display.show(S.confirmScreen(view.summary, view.heard))
    case 'listening': return display.show(S.listeningScreen())
    case 'thinking': return display.show(S.thinkingScreen())
    case 'result': return display.show(S.resultScreen(view.msg, view.ok))
    case 'risk': {
      const r = state?.positions.find(x => x.symbol === (view as { symbol: string }).symbol)
      return r ? display.show(S.riskScreen(r)) : back()
    }
    case 'alert': return display.show(S.alertScreen(view.alert, state?.positions.find(x => x.symbol === (view as { alert: Alert }).alert.symbol)?.mark))
  }
}

function go(v: View) { view = v; clearTimeout(resultTimer); render() }
function back() { go({ kind: 'card' }) }

async function refresh() {
  try {
    state = await api.state()
    lastOk = Date.now(); fetchError = null
    phone.state(state)
    // Risk and alerts interrupt only the resting card, never a decision in progress.
    if (view.kind === 'card') {
      const risky = state.risk && !dismissedRisk.has(state.risk) ? state.risk : null
      if (state.triggered.length) return go({ kind: 'alert', alert: state.triggered[0] })
      if (risky) return go({ kind: 'risk', symbol: risky })
    }
    // Forget a dismissal once that position is out of the danger zone.
    for (const s of dismissedRisk) if (state.risk !== s) dismissedRisk.delete(s)
  } catch (e) {
    fetchError = (e as Error).message
  }
  if (view.kind === 'card' || view.kind === 'risk') render()
}

async function execute(command: Command) {
  go({ kind: 'thinking' })
  try {
    const { result } = await api.act(command)
    phone.log(`✓ ${result}`)
    showResult(result, true)
  } catch (e) {
    phone.log(`✗ ${(e as Error).message}`)
    showResult((e as Error).message, false)
  }
  refresh()
}

function showResult(msg: string, ok: boolean) {
  go({ kind: 'result', msg, ok })
  resultTimer = window.setTimeout(back, RESULT_MS)
}

async function understood(u: { text: string; command: Command; summary: string }) {
  phone.log(`"${u.text || '…'}" → ${u.summary}`)
  if (u.command.kind === 'unknown') return showResult(u.text ? `${u.summary}\nHeard: "${u.text.slice(0, 60)}"` : "Didn't hear anything", false)
  go({ kind: 'confirm', command: u.command, summary: u.summary, heard: u.text })
}

async function runText(text: string) {
  go({ kind: 'thinking' })
  try { await understood(await api.parse(text)) } catch (e) { showResult((e as Error).message, false) }
}

// ── Voice: hold to talk ─────────────────────────────────────────
let chunks: Uint8Array[] = []
let listening = false
let listenTimer = 0

async function startListening() {
  if (listening) return
  listening = true; chunks = []
  go({ kind: 'listening' })
  await bridge.audioControl(true, AudioInputSource.Glasses)
  listenTimer = window.setTimeout(stopListening, MAX_LISTEN_MS)
}

async function stopListening() {
  if (!listening) return
  listening = false; clearTimeout(listenTimer)
  await bridge.audioControl(false)
  const pcm = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) { pcm.set(c, o); o += c.length }
  go({ kind: 'thinking' })
  try { await understood(await api.voice(pcm)) } catch (e) { showResult((e as Error).message, false) }
}

// ── Input ───────────────────────────────────────────────────────
let lastSwipe = 0
function typeOf(env?: { eventType?: OsEventTypeList }) { return env ? env.eventType ?? OsEventTypeList.CLICK_EVENT : null }

function onEvent(e: EvenHubEvent) {
  if (e.audioEvent?.audioPcm) { if (listening) chunks.push(e.audioEvent.audioPcm); return }
  const t = typeOf(e.textEvent) ?? typeOf(e.sysEvent) ?? typeOf(e.listEvent)
  if (t === null) return
  const E = OsEventTypeList
  if (t === E.SYSTEM_EXIT_EVENT || t === E.ABNORMAL_EXIT_EVENT) { bridge.audioControl(false); return }
  if (t === E.FOREGROUND_ENTER_EVENT) { display.invalidate(); render(); return }
  if (t === E.LONG_PRESS_EVENT) { if (['card', 'risk', 'result'].includes(view.kind)) startListening(); return }
  if (t === E.LONG_PRESS_RELEASE_EVENT) { stopListening(); return }
  if (t === E.SCROLL_TOP_EVENT || t === E.SCROLL_BOTTOM_EVENT) {
    if (Date.now() - lastSwipe < 300) return
    lastSwipe = Date.now()
    return swipe(t === E.SCROLL_BOTTOM_EVENT ? 1 : -1)
  }
  if (t === E.DOUBLE_CLICK_EVENT) {
    if (view.kind === 'card') return void bridge.shutDownPageContainer(1) // root: system exit dialog
    if (view.kind === 'listening') { listening = false; bridge.audioControl(false) }
    if (view.kind === 'risk') dismissedRisk.add(view.symbol)
    return back()
  }
  if (t === E.CLICK_EVENT) return tap()
}

function swipe(dir: 1 | -1) {
  const n = state?.positions.length ?? 0
  if (view.kind === 'card' && n) { idx = (idx + dir + n) % n; render() }
  else if (view.kind === 'actions') { const len = current()?.actions.length ?? 1; go({ kind: 'actions', sel: (view.sel + dir + len) % len }) }
  else if (view.kind === 'risk') { dismissedRisk.add(view.symbol); back() }
}

function tap() {
  const p = current()
  switch (view.kind) {
    case 'card': if (p) go({ kind: 'actions', sel: 0 }); return
    case 'actions': if (p) execute(p.actions[view.sel].command); return
    case 'confirm': execute(view.command); return
    case 'risk': {
      const r = state?.positions.find(x => x.symbol === (view as { symbol: string }).symbol)
      if (r) { idx = state!.positions.indexOf(r); go({ kind: 'actions', sel: 0 }) }
      return
    }
    case 'alert': api.ack().then(refresh); back(); return
    case 'result': back(); return
  }
}

bridge.onEvenHubEvent(onEvent)
render()
await refresh()
setInterval(refresh, POLL_MS)
