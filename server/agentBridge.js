import rateLimit from 'express-rate-limit'
import { appendFileSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'

const MAX_TURNS    = parseInt(process.env.AGENT_BRIDGE_MAX_TURNS        || '8')
const TIMEOUT_MS   = parseInt(process.env.AGENT_BRIDGE_TIMEOUT_MS       || '30000')
const MAX_BYTES    = parseInt(process.env.AGENT_BRIDGE_MAX_PAYLOAD_BYTES || '32768')
const SECRET       = process.env.AGENT_BRIDGE_SECRET
const AGENT_CHAT   = process.env.R1_AGENT_CHAT_ID  // 8781998274

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

function buildContextBlock(conversation, latestUserText, latestRabbitOSText) {
  // Keep FIRST_MSG at index 0, trim remaining to MAX_TURNS
  const rest = conversation.filter((_, i) => i !== 0).slice(-MAX_TURNS)
  const ctx = [FIRST_MSG, ...rest]

  const prevLines = ctx.slice(1)
    .map(m => `[${m.role}] ${m.content}`)
    .join('\n')

  return `🐇 R1 session update\n\n[user] ${latestUserText}\n[rabbitos] ${latestRabbitOSText}${prevLines ? `\n\nPrevious context:\n${prevLines}` : ''}\n\n→ Please respond concisely (3 lines max for headline summary, bullet points preferred).`
}

async function sendAndWait(telegram, formattedText, seqId) {
  const sent = await telegram.sendMessage(AGENT_CHAT, { message: formattedText })
  const sentId = Number(sent.id)
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const msgs = await telegram.getMessages(AGENT_CHAT, { limit: 5, minId: sentId })
      // incoming = agent reply (not our own outgoing message)
      const agentMsg = msgs.find(m => !m.out && m.message)
      if (agentMsg) return { reply: agentMsg.message, seqId }
    } catch (_) {}
  }
  return { reply: '(agent timeout)', seqId }
}

export function registerAgentBridgeRoutes(app, telegram) {
  const limiter = rateLimit({ windowMs: 60_000, max: 20 })

  app.get('/agent-bridge/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() })
  })

  app.post('/agent-bridge', limiter, async (req, res) => {
    const t0 = Date.now()
    const deviceIdHash = hashIp(req.ip)

    // Content-Length guard — reject before parsing body
    const len = parseInt(req.headers['content-length'] || '0', 10)
    if (len > MAX_BYTES) {
      writeLog({ ts: new Date().toISOString(), deviceIdHash, payloadBytes: len, status: 'rejected_size', latencyMs: 0 })
      return res.status(413).json({ error: 'payload too large' })
    }

    // Auth
    const auth = req.headers['authorization'] || ''
    if (!SECRET || auth !== `Bearer ${SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const {
      conversation = [],
      latestUserText = '',
      latestRabbitOSText = '',
      seqId = 0,
    } = req.body

    let result
    let status = 'ok'
    try {
      const formatted = buildContextBlock(conversation, latestUserText, latestRabbitOSText)
      result = await sendAndWait(telegram, formatted, seqId)
      if (result.reply.startsWith('(agent timeout)')) status = 'timeout'
    } catch (e) {
      result = { reply: '(agent unreachable)', seqId }
      status = 'error'
    }

    const latencyMs = Date.now() - t0
    writeLog({ ts: new Date().toISOString(), deviceIdHash, payloadBytes: len, status, latencyMs })

    res.json(result)
  })
}
