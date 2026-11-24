import { execFile } from 'node:child_process'
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

/** Local speech-to-text with whisper.cpp. Returns the transcript (may be empty). */
export async function transcribe(pcm: Uint8Array): Promise<string> {
  if (!sttReady()) throw new Error('Speech model missing: run scripts/get-model.sh')
  const dir = await mkdtemp(join(tmpdir(), 'tape-'))
  const wav = join(dir, 'in.wav')
  try {
    await writeFile(wav, pcmToWav(pcm))
    const out = await new Promise<string>((res, rej) =>
      execFile(BIN, ['-m', MODEL, '-f', wav, '-nt', '-np', '-l', 'en', '--prompt', PROMPT], { timeout: 20000 }, (e, so) => (e ? rej(e) : res(so))),
    )
    return out.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
