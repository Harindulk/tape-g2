import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODEL = process.env.WHISPER_MODEL ?? join(import.meta.dirname, 'models', 'ggml-base.en.bin')
const BIN = process.env.WHISPER_BIN ?? 'whisper-cli'

/** Wrap raw PCM s16le 16 kHz mono (what G2 sends) in a WAV header. */
export function pcmToWav(pcm: Uint8Array, rate = 16000): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, Buffer.from(pcm)])
}

export const sttReady = () => existsSync(MODEL)

// Biases whisper toward the words this app understands.
const PROMPT = 'close half of ETH. stop to breakeven on BTC. take profit SOL at 160. alert me if bitcoin drops below 58k.'

const PORT = Number(process.env.WHISPER_PORT ?? 8788)
const SERVER_BIN = process.env.WHISPER_SERVER_BIN ?? 'whisper-server'
let child: ChildProcess | null = null

/** Starts whisper.cpp's server once so the model stays loaded (~0.2 s per command instead of ~8 s). */
export function startWhisper(): void {
  if (child || !sttReady()) return
  child = spawn(SERVER_BIN, ['-m', MODEL, '--port', String(PORT), '-l', 'en'], { stdio: 'ignore' })
  child.on('error', () => { child = null })
  const stop = () => child?.kill()
  process.on('exit', stop)
  process.on('SIGINT', () => { stop(); process.exit(0) })
  process.on('SIGTERM', () => { stop(); process.exit(0) })
}

/** Local speech-to-text with whisper.cpp. Uses the warm server, falls back to the CLI. */
export async function transcribe(pcm: Uint8Array): Promise<string> {
  if (!sttReady()) throw new Error('Speech model missing: run scripts/get-model.sh')
  const wavBuf = pcmToWav(pcm)
  try {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wavBuf)], { type: 'audio/wav' }), 'in.wav')
    form.append('response_format', 'json')
    form.append('prompt', PROMPT)
    const r = await fetch(`http://127.0.0.1:${PORT}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) })
    if (r.ok) return clean(((await r.json()) as { text?: string }).text ?? '')
  } catch { /* server not up yet: use the CLI */ }
  const dir = await mkdtemp(join(tmpdir(), 'tape-'))
  const wav = join(dir, 'in.wav')
  try {
    await writeFile(wav, wavBuf)
    const out = await new Promise<string>((res, rej) =>
      execFile(BIN, ['-m', MODEL, '-f', wav, '-nt', '-np', '-l', 'en', '--prompt', PROMPT], { timeout: 20000 }, (e, so) => (e ? rej(e) : res(so))),
    )
    return clean(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const clean = (s: string) => s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
