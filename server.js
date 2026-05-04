import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const API_ID      = parseInt(process.env.TELEGRAM_API_ID, 10);
const API_HASH    = process.env.TELEGRAM_API_HASH;
const SESSION_STR = process.env.TELEGRAM_SESSION;
const AUTH_TOKEN  = process.env.R1_AUTH_TOKEN;

if (!API_ID || !API_HASH || !SESSION_STR) {
  console.error('Missing Telegram credentials. Run `npm run setup` first.');
  process.exit(1);
}

// ─── Telegram Client ─────────────────────────────────────────────────
const session  = new StringSession(SESSION_STR);
const telegram = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });

let clientReady = false;

async function connectTelegram() {
  await telegram.connect();
  clientReady = true;
  console.log('✓ Telegram client connected.');

  telegram.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg) return;
    const sender = await msg.getSender();
    const chatId = msg.chatId?.toString();
    broadcastWS({
      type: 'new_message',
      chatId,
      message: {
        id:         msg.id,
        text:       msg.text || '',
        date:       msg.date,
        out:        msg.out,
        senderName: sender
          ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.title || 'Unknown'
          : 'Unknown',
        hasPhoto:   !!msg.media?.photo,
      },
    });
  }, new NewMessage({}));
}

// ─── Express App ─────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

function auth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (AUTH_TOKEN && token !== AUTH_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  if (!clientReady) return res.status(503).json({ error: 'Telegram client not ready' });
  next();
}

// ─── Static: serve creation + harness ────────────────────────────────
function serveFile(filename) {
  return (_req, res) => {
    const f = join(__dirname, filename);
    if (!existsSync(f)) return res.status(404).send(filename + ' not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(readFileSync(f));
  };
}
app.get('/',        serveFile('index.html'));
app.get('/index.html',  serveFile('index.html'));
app.get('/harness', serveFile('harness.html'));

// ─── Health ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, telegram: clientReady }));

// ─── GET /chats ──────────────────────────────────────────────────────
app.get('/chats', auth, async (_req, res) => {
  try {
    const dialogs = await telegram.getDialogs({ limit: 30, archived: false });
    res.json({ chats: dialogs.map((d) => ({
      id:          d.id?.toString(),
      name:        d.title || d.name || 'Unknown',
      unread:      d.unreadCount || 0,
      lastMessage: d.message?.text?.slice(0, 80) || '',
      lastDate:    d.message?.date || 0,
      isGroup:     !!d.isGroup,
      isChannel:   !!d.isChannel,
    }))});
  } catch (err) {
    console.error('GET /chats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /chats/:id/messages ─────────────────────────────────────────
app.get('/chats/:id/messages', auth, async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit) || 20, 50);
    const entity   = await telegram.getEntity(req.params.id);
    const messages = await telegram.getMessages(entity, { limit });
    const result   = [];
    for (const m of messages) {
      let senderName = 'Unknown';
      try {
        const s = await m.getSender();
        if (s) senderName = [s.firstName, s.lastName].filter(Boolean).join(' ') || s.title || 'Unknown';
      } catch {}
      result.push({ id: m.id, text: m.text || '', date: m.date, out: m.out, senderName, hasPhoto: !!m.media?.photo });
    }
    result.reverse();
    res.json({ messages: result });
  } catch (err) {
    console.error('GET /chats/:id/messages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /chats/:id/send ────────────────────────────────────────────
app.post('/chats/:id/send', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Missing text' });
    const entity = await telegram.getEntity(req.params.id);
    const sent   = await telegram.sendMessage(entity, { message: text.trim() });
    res.json({ ok: true, messageId: sent.id });
  } catch (err) {
    console.error('POST /chats/:id/send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /chats/:id/read ────────────────────────────────────────────
app.post('/chats/:id/read', auth, async (req, res) => {
  try {
    const entity = await telegram.getEntity(req.params.id);
    await telegram.markAsRead(entity);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /chats/:id/read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /chats/read-all ─────────────────────────────────────────────
app.post('/chats/read-all', auth, async (_req, res) => {
  try {
    const dialogs = await telegram.getDialogs({ limit: 30, archived: false });
    const unread = dialogs.filter(d => (d.unreadCount || 0) > 0);
    for (const d of unread) {
      const entity = await telegram.getEntity(d.id);
      await telegram.markAsRead(entity);
    }
    res.json({ ok: true, marked: unread.length });
  } catch (err) {
    console.error('POST /chats/read-all error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /tts ───────────────────────────────────────────────────────
app.post('/tts', auth, async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'TTS not configured — set OPENAI_API_KEY in .env' });
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Missing text' });
  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: 'nova', input: text.trim().slice(0, 4096) }),
    });
    if (!r.ok) throw new Error(`TTS ${r.status}: ${await r.text()}`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('POST /tts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /stt ───────────────────────────────────────────────────────
app.post('/stt', auth, express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'STT not configured — set OPENAI_API_KEY in .env' });
  try {
    const form = new FormData();
    form.append('file', new Blob([req.body], { type: 'audio/webm' }), 'audio.webm');
    form.append('model', 'whisper-1');
    form.append('response_format', 'json');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
    });
    if (!r.ok) throw new Error(`Whisper ${r.status}: ${await r.text()}`);
    res.json({ text: (await r.json()).text || '' });
  } catch (err) {
    console.error('POST /stt error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /chats/:chatId/messages/:msgId/photo ─────────────────────────
app.get('/chats/:chatId/messages/:msgId/photo', auth, async (req, res) => {
  try {
    const entity = await telegram.getEntity(req.params.chatId);
    const msgs   = await telegram.getMessages(entity, { ids: [parseInt(req.params.msgId)] });
    if (!msgs[0]?.media?.photo) return res.status(404).send('No photo');
    const photo     = msgs[0].media.photo;
    const thumbSize = photo.sizes?.find(s => s.type === 'm') || photo.sizes?.[0];
    const buffer    = await telegram.downloadMedia(msgs[0], { thumb: thumbSize });
    if (!buffer) return res.status(404).send('Download failed');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('GET photo error:', err.message);
    res.status(500).send(err.message);
  }
});

// ─── WebSocket ───────────────────────────────────────────────────────
const server    = createServer(app);
const wss       = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Set();

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, `http://${req.headers.host}`).searchParams.get('token');
  if (AUTH_TOKEN && token !== AUTH_TOKEN) { ws.close(4001, 'Unauthorized'); return; }
  wsClients.add(ws);
  ws.isAlive = true;
  ws.on('pong',  () => { ws.isAlive = true; });
  ws.on('close', () => wsClients.delete(ws));
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 30_000);

function broadcastWS(data) {
  const json = JSON.stringify(data);
  for (const ws of wsClients) if (ws.readyState === WebSocket.OPEN) ws.send(json);
}

// ─── Start ───────────────────────────────────────────────────────────
(async () => {
  await connectTelegram();
  server.listen(PORT, () => {
    const t = AUTH_TOKEN ? `&token=${encodeURIComponent(AUTH_TOKEN)}` : '';
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  R1 Telegram Backend — ready on :${PORT}
╠══════════════════════════════════════════════════════════════╣
║  Creation  →  http://localhost:${PORT}/?backend=http://localhost:${PORT}${t}
║  Harness   →  http://localhost:${PORT}/harness
╚══════════════════════════════════════════════════════════════╝

Expose publicly (required for R1 device):
  npx cloudflared tunnel --url http://localhost:${PORT}

Then paste the https:// URL printed by cloudflared as your backend URL.
The creation URL becomes:  https://<tunnel>.trycloudflare.com/?backend=https://<tunnel>.trycloudflare.com${t}
`);
  });
})();
