import rateLimit from 'express-rate-limit'
import { appendFileSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'

const MAX_TURNS    = parseInt(process.env.AGENT_BRIDGE_MAX_TURNS        || '8')
const TIMEOUT_MS   = parseInt(process.env.AGENT_BRIDGE_TIMEOUT_MS       || '30000')
const MAX_BYTES    = parseInt(process.env.AGENT_BRIDGE_MAX_PAYLOAD_BYTES || '32768')
const SECRET       = process.env.AGENT_BRIDGE_SECRET
const AGENT_CHAT   = process.env.R1_AGENT_CHAT_ID  // 8781998274 (Claude)
const PI_CHAT      = process.env.PI_AGENT_CHAT_ID  // 8385747928 (Pi)

const LOG_PATH = '/home/openclaw/logs/agent-bridge.log'
const FIRST_MSG = { role: 'system', content: "You are a dev agent companion on William's Rabbit R1. Be concise." }

function writeLog(entry) {
  try {
    mkdirSync('/home/openclaw/logs', { recursive: true })
    appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n')
  } catch (_) {}
}

function hashIp(ip) {
  return createHash('sha256').update(ip || '').digest('hex').slice(0, 8)
}

function buildContextBlock(conversation, latestUserText, latestRabbitOSText, stripUserPrompt, injectStep) {
  if (injectStep === 1) {
    return `🔁 R1 inject — step 1: user → Claude → RabbitOS\n\n[user] ${latestUserText}\n\nConstruct a focused prompt for RabbitOS based on the above.`
  }
  if (injectStep === 2) {
    return `🔁 R1 inject — step 2: RabbitOS responded, completing the loop\n\n[rabbitos] ${latestRabbitOSText}\n\nProvide your final synthesis.`
  }
  if (stripUserPrompt) return `🐇 R1 session update\n\n[rabbitos] ${latestRabbitOSText}`
  return `🐇 R1 session update\n\n[user] ${latestUserText}\n[rabbitos] ${latestRabbitOSText}`
}

async function sendAndWait(telegram, entity, chatId, formattedText, seqId) {
  const sent = await telegram.sendMessage(entity, { message: formattedText })
  const sentId = Number(sent.id)
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const msgs = await telegram.getMessages(chatId, { limit: 5, minId: sentId })
      const agentMsg = msgs.find(m => !m.out && m.message)
      if (agentMsg) return { reply: agentMsg.message, seqId }
    } catch (_) {}
  }
  return { reply: '(agent timeout)', seqId }
}

export function registerAgentBridgeRoutes(app, telegram) {
  const limiter = rateLimit({ windowMs: 60_000, max: 20, validate: { xForwardedForHeader: false } })

  // In-memory inject queue — single pending inject, cleared on read
  let pendingInject = null

  let agentEntity = null
  let piEntity = null
  ;(async () => {
    try {
      await telegram.getDialogs({ limit: 50, archived: false })
      agentEntity = await telegram.getEntity(AGENT_CHAT)
      console.log('[agent-bridge] Claude entity resolved:', agentEntity?.id?.toString())
      if (PI_CHAT) {
        piEntity = await telegram.getEntity(PI_CHAT)
        console.log('[agent-bridge] Pi entity resolved:', piEntity?.id?.toString())
      }
    } catch (e) {
      console.error('[agent-bridge] Failed to resolve agent entity at startup:', e.message)
    }
  })()

  app.get('/agent-bridge/session-chats', (_req, res) => {
    res.json({ claude: AGENT_CHAT || null, pi: PI_CHAT || null })
  })

  app.get('/agent-bridge/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), agentReady: !!agentEntity, piReady: !!piEntity })
  })

  // POST /inject — queue a prompt to be delivered to the R1 device on next poll
  app.post('/inject', (req, res) => {
    const auth = req.headers['authorization'] || ''
    if (!SECRET || auth !== `Bearer ${SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    const { prompt } = req.body
    if (!prompt?.trim()) return res.status(400).json({ error: 'missing prompt' })
    pendingInject = { id: `inj_${Date.now()}`, prompt: prompt.trim(), ts: new Date().toISOString() }
    console.log(`[inject] queued: "${pendingInject.prompt.slice(0, 80)}"`)
    res.json({ ok: true, id: pendingInject.id })
  })

  // GET /inject/pending — R1 polls this; clears the queue on read
  app.get('/inject/pending', (req, res) => {
    const auth = req.headers['authorization'] || ''
    if (!SECRET || auth !== `Bearer ${SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    const inject = pendingInject
    pendingInject = null
    res.json({ pending: inject })
  })

  app.post('/agent-bridge', limiter, async (req, res) => {
    const t0 = Date.now()
    const deviceIdHash = hashIp(req.ip)

    const len = parseInt(req.headers['content-length'] || '0', 10)
    if (len > MAX_BYTES) {
      writeLog({ ts: new Date().toISOString(), deviceIdHash, payloadBytes: len, status: 'rejected_size', latencyMs: 0 })
      return res.status(413).json({ error: 'payload too large' })
    }

    const auth = req.headers['authorization'] || ''
    if (!SECRET || auth !== `Bearer ${SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const {
      conversation = [],
      latestUserText = '',
      latestRabbitOSText = '',
      stripUserPrompt = false,
      seqId = 0,
      target = 'claude',
      injectStep = 0,
    } = req.body

    const isPi = target === 'pi' && !!PI_CHAT
    const entity = isPi ? (piEntity || PI_CHAT) : (agentEntity || AGENT_CHAT)
    const chatId = isPi ? PI_CHAT : AGENT_CHAT

    let result
    let status = 'ok'
    try {
      const formatted = buildContextBlock(conversation, latestUserText, latestRabbitOSText, stripUserPrompt, injectStep)
      result = await sendAndWait(telegram, entity, chatId, formatted, seqId)
      if (result.reply.startsWith('(agent timeout)')) status = 'timeout'
    } catch (e) {
      console.error('[agent-bridge] Error:', e.message)
      result = { reply: '(agent unreachable)', seqId }
      status = 'error'
    }

    const latencyMs = Date.now() - t0
    writeLog({ ts: new Date().toISOString(), deviceIdHash, payloadBytes: len, status, target, latencyMs })

    res.json(result)
  })
}
