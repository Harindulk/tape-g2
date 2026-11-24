// Optional: when ANTHROPIC_API_KEY is set, Claude rewrites loose phrasing into one canonical
// command that the rule parser then validates. Claude never executes anything itself.
const KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.TAPE_LLM_MODEL ?? 'claude-haiku-5-5'

export const llmEnabled = () => Boolean(KEY)

export async function canonicalise(text: string, open: string[]): Promise<string | null> {
  if (!KEY) return null
  const system = `You turn a trader's spoken phrase into ONE canonical command, or NONE.
Open positions: ${open.join(', ') || 'none'}.
Allowed forms (use the coin ticker, e.g. BTC):
close <fraction like half|quarter|all|NN%> of <COIN>
stop to breakeven on <COIN>
stop <COIN> at <PRICE>
take profit <COIN> at <PRICE>
alert me if <COIN> goes below|above <PRICE>
Reply with the command only. If unclear or not one of these, reply NONE.`
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 40, system, messages: [{ role: 'user', content: text }] }),
    signal: AbortSignal.timeout(6000),
  })
  if (!r.ok) return null
  const j = (await r.json()) as { content?: Array<{ type: string; text?: string }> }
  const out = j.content?.find(c => c.type === 'text')?.text?.trim() ?? ''
  return !out || /^none$/i.test(out) ? null : out
}
