// Telegram Bot API sender for alerts while the glasses app is closed.
// No token: messages go to the server log (outbox) so the flow can be seen without a bot.

export type Notify = (text: string) => Promise<void>

async function findChat(token: string): Promise<string | undefined> {
  const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(8000) })
  const j = (await r.json()) as { ok: boolean; result?: Array<{ message?: { chat: { id: number } } }> }
  const last = j.result?.filter(u => u.message).pop()
  return last ? String(last.message!.chat.id) : undefined
}

export function telegramNotifier(token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID): { notify: Notify; mode: string } {
  if (!token) return { mode: 'outbox (no TELEGRAM_BOT_TOKEN)', notify: async t => { console.log(`[telegram outbox] ${t}`) } }
  let chat = chatId
  return {
    mode: 'bot',
    notify: async text => {
      chat ??= await findChat(token).catch(() => undefined)
      if (!chat) { console.log('[telegram] send /start to your bot once so Tape knows where to write'); return }
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) console.log(`[telegram] send failed: HTTP ${r.status}`)
    },
  }
}
