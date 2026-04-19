import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { computeCheck } from 'telegram/Password.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Env / Config ────────────────────────────────────────────────────
const PORT     = process.env.PORT || 3000;
const API_ID   = parseInt(process.env.TELEGRAM_API_ID, 10);
const API_HASH = process.env.TELEGRAM_API_HASH;

if (!API_ID || !API_HASH) {
  console.error(`
❌ Missing TELEGRAM_API_ID or TELEGRAM_API_HASH.

Get them from https://my.telegram.org → API Development Tools, then put
them in .env:

    TELEGRAM_API_ID=12345678
    TELEGRAM_API_HASH=abcd1234abcd1234abcd1234abcd1234

After that, run: npm run setup
`);
  process.exit(1);
}

// Persistent data dir. If /data exists (common on cloud hosts with a
// mounted volume) we use it; otherwise fall back to a local folder
// alongside server.js.
const DATA_DIR = existsSync('/data')
  ? '/data'
  : join(__dirname, '.r1-data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const SESSION_FILE = join(DATA_DIR, 'session.txt');
const TOKEN_FILE   = join(DATA_DIR, 'auth-token.txt');

// ─── Auth token — gates the R1 instance ─────────────────────────────
// Priority: env var → persisted file → freshly generated.
// This value is what you append to your tunnel URL as ?token=…, which
// then goes into boondit.site/r1-generator to make the R1 install QR.
let AUTH_TOKEN = process.env.R1_AUTH_TOKEN?.trim() || null;

if (!AUTH_TOKEN) {
  if (existsSync(TOKEN_FILE)) {
    AUTH_TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
  } else {
    AUTH_TOKEN = crypto.randomBytes(24).toString('base64url');
    try { writeFileSync(TOKEN_FILE, AUTH_TOKEN); } catch {}
  }
}

// ─── Telegram client ────────────────────────────────────────────────
// Seed the session from env var first, then disk. Empty string = fresh
// client that will need to go through the web login flow.
const SESSION_SEED =
  process.env.TELEGRAM_SESSION?.trim() ||
  (existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, 'utf8').trim() : '') ||
  '';

const session  = new StringSession(SESSION_SEED);
const telegram = new TelegramClient(session, API_ID, API_HASH, {
  connectionRetries: 5,
});

let clientReady = false;   // connected to Telegram
let loggedIn    = false;   // holds a valid user session
let meCache     = null;

// Ephemeral state for the web login flow. Cleared after success.
let authState = { phone: null, phoneCodeHash: null };

async function initTelegram() {
  await telegram.connect();
  clientReady = true;

  try {
    loggedIn = await telegram.isUserAuthorized();
  } catch {
    loggedIn = false;
  }

  if (loggedIn) {
    attachMessageHandler();
    try {
      meCache = await telegram.getMe();
      console.log(`✓ Telegram connected — logged in as ${meCache.firstName || meCache.username || meCache.id}`);
    } catch {
      console.log('✓ Telegram connected (logged in).');
    }
  } else {
    console.log('⧗ Telegram connected — awaiting web login.');
  }
}

function attachMessageHandler() {
  telegram.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg) return;
    let senderName = 'Unknown';
    try {
      const s = await msg.getSender();
      if (s) {
        senderName =
          [s.firstName, s.lastName].filter(Boolean).join(' ') ||
          s.title ||
          'Unknown';
      }
    } catch {}
    broadcastWS({
      type: 'new_message',
      chatId: msg.chatId?.toString(),
      message: {
        id:         msg.id,
        text:       msg.text || '',
        date:       msg.date,
        out:        msg.out,
        senderName,
      },
    });
  }, new NewMessage({}));
}

// ─── Express ────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// Full auth: valid token + connected + logged in. Used by data endpoints.
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token !== AUTH_TOKEN)  return res.status(401).json({ error: 'Unauthorized' });
  if (!clientReady)          return res.status(503).json({ error: 'Telegram client not ready' });
  if (!loggedIn)             return res.status(409).json({ error: 'Not logged in', needsLogin: true });
  next();
}

// Token-only auth: used by the login endpoints (which run BEFORE loggedIn=true).
function requireToken(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token !== AUTH_TOKEN)  return res.status(401).json({ error: 'Unauthorized' });
  if (!clientReady)          return res.status(503).json({ error: 'Telegram client not ready' });
  next();
}

// ─── Static: serve index.html ───────────────────────────────────────
function serveIndex(_req, res) {
  const f = join(__dirname, 'index.html');
  if (!existsSync(f)) return res.status(404).send('index.html not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(readFileSync(f));
}
app.get('/',            serveIndex);
app.get('/index.html',  serveIndex);

// ─── Health (no auth — useful for uptime pings) ─────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, telegram: clientReady, loggedIn });
});

// ─── Auth: status ────────────────────────────────────────────────────
// Frontend calls this on boot to decide: login screen vs chat screen.
app.get('/auth/status', requireToken, (_req, res) => {
  res.json({
    loggedIn,
    me: loggedIn && meCache ? {
      firstName: meCache.firstName || '',
      lastName:  meCache.lastName  || '',
      username:  meCache.username  || '',
      phone:     meCache.phone     || '',
    } : null,
  });
});

// ─── Auth: send code ────────────────────────────────────────────────
app.post('/auth/send-code', requireToken, async (req, res) => {
  if (loggedIn) return res.status(400).json({ error: 'Already logged in' });
  const phone = (req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  try {
    const result = await telegram.invoke(new Api.auth.SendCode({
      phoneNumber: phone,
      apiId:       API_ID,
      apiHash:     API_HASH,
      settings:    new Api.CodeSettings({}),
    }));
    authState = { phone, phoneCodeHash: result.phoneCodeHash };
    res.json({ ok: true });
  } catch (err) {
    console.error('/auth/send-code:', err.errorMessage || err.message);
    res.status(400).json({ error: err.errorMessage || err.message });
  }
});

// ─── Auth: sign in ──────────────────────────────────────────────────
app.post('/auth/sign-in', requireToken, async (req, res) => {
  if (loggedIn) return res.status(400).json({ error: 'Already logged in' });
  const code = (req.body?.code || '').trim();
  if (!authState.phone || !authState.phoneCodeHash) {
    return res.status(400).json({ error: 'No pending code — call /auth/send-code first' });
  }
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    await telegram.invoke(new Api.auth.SignIn({
      phoneNumber:   authState.phone,
      phoneCodeHash: authState.phoneCodeHash,
      phoneCode:     code,
    }));
    await finalizeLogin();
    res.json({ ok: true, needs2fa: false });
  } catch (err) {
    const msg = err.errorMessage || err.message || '';
    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
      return res.json({ ok: true, needs2fa: true });
    }
    console.error('/auth/sign-in:', msg);
    res.status(400).json({ error: msg });
  }
});

// ─── Auth: 2FA password check ───────────────────────────────────────
app.post('/auth/check-password', requireToken, async (req, res) => {
  if (loggedIn) return res.status(400).json({ error: 'Already logged in' });
  const password = req.body?.password || '';
  if (!password) return res.status(400).json({ error: 'Missing password' });

  try {
    const pwdInfo = await telegram.invoke(new Api.account.GetPassword());
    const srp     = await computeCheck(pwdInfo, password);
    await telegram.invoke(new Api.auth.CheckPassword({ password: srp }));
    await finalizeLogin();
    res.json({ ok: true });
  } catch (err) {
    const msg = err.errorMessage || err.message || '';
    console.error('/auth/check-password:', msg);
    res.status(400).json({ error: msg });
  }
});

// ─── Auth: logout ───────────────────────────────────────────────────
app.post('/auth/logout', requireAuth, async (_req, res) => {
  try {
    try { await telegram.invoke(new Api.auth.LogOut()); } catch {}
    loggedIn = false;
    meCache  = null;
    try { if (existsSync(SESSION_FILE)) writeFileSync(SESSION_FILE, ''); } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function finalizeLogin() {
  const sessionStr = telegram.session.save();

  try {
    writeFileSync(SESSION_FILE, sessionStr);
    console.log('✓ Session persisted to', SESSION_FILE);
  } catch (err) {
    console.warn('⚠  Could not write session file:', err.message);
  }

  loggedIn  = true;
  authState = { phone: null, phoneCodeHash: null };
  attachMessageHandler();

  try { meCache = await telegram.getMe(); } catch {}
}

// ─── Data: chats ────────────────────────────────────────────────────
app.get('/chats', requireAuth, async (_req, res) => {
  try {
    const dialogs = await telegram.getDialogs({ limit: 30 });
    res.json({
      chats: dialogs.map((d) => ({
        id:          d.id?.toString(),
        name:        d.title || d.name || 'Unknown',
        unread:      d.unreadCount || 0,
        lastMessage: d.message?.text?.slice(0, 80) || '',
        lastDate:    d.message?.date || 0,
        isGroup:     !!d.isGroup,
        isChannel:   !!d.isChannel,
      })),
    });
  } catch (err) {
    console.error('GET /chats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Data: messages ─────────────────────────────────────────────────
app.get('/chats/:id/messages', requireAuth, async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit) || 20, 50);
    const entity   = await telegram.getEntity(req.params.id);
    const messages = await telegram.getMessages(entity, { limit });
    const result   = [];
    for (const m of messages) {
      let senderName = 'Unknown';
      try {
        const s = await m.getSender();
        if (s) {
          senderName =
            [s.firstName, s.lastName].filter(Boolean).join(' ') ||
            s.title ||
            'Unknown';
        }
      } catch {}
      result.push({
        id:   m.id,
        text: m.text || '',
        date: m.date,
        out:  m.out,
        senderName,
      });
    }
    result.reverse();
    res.json({ messages: result });
  } catch (err) {
    console.error('GET /chats/:id/messages:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Data: send ─────────────────────────────────────────────────────
app.post('/chats/:id/send', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Missing text' });
    const entity = await telegram.getEntity(req.params.id);
    const sent   = await telegram.sendMessage(entity, { message: text.trim() });
    res.json({ ok: true, messageId: sent.id });
  } catch (err) {
    console.error('POST /chats/:id/send:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Data: mark read ────────────────────────────────────────────────
app.post('/chats/:id/read', requireAuth, async (req, res) => {
  try {
    const entity = await telegram.getEntity(req.params.id);
    await telegram.markAsRead(entity);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /chats/:id/read:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── STT (optional, unchanged behaviour) ────────────────────────────
app.post('/stt', requireAuth, express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'STT not configured — set OPENAI_API_KEY in your env' });
  try {
    const form = new FormData();
    form.append('file', new Blob([req.body], { type: 'audio/webm' }), 'audio.webm');
    form.append('model', 'whisper-1');
    form.append('response_format', 'json');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    });
    if (!r.ok) throw new Error(`Whisper ${r.status}: ${await r.text()}`);
    res.json({ text: (await r.json()).text || '' });
  } catch (err) {
    console.error('POST /stt:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── WebSocket ──────────────────────────────────────────────────────
const server    = createServer(app);
const wss       = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Set();

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, `http://${req.headers.host}`).searchParams.get('token');
  if (token !== AUTH_TOKEN) { ws.close(4001, 'Unauthorized'); return; }
  wsClients.add(ws);
  ws.isAlive = true;
  ws.on('pong',  () => { ws.isAlive = true; });
  ws.on('close', () => wsClients.delete(ws));
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

function broadcastWS(data) {
  const json = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

// ─── Start ──────────────────────────────────────────────────────────
(async () => {
  await initTelegram();

  server.listen(PORT, () => {
    const tokenQS = `?token=${encodeURIComponent(AUTH_TOKEN)}`;
    const localUrl = `http://localhost:${PORT}/${tokenQS}`;

    if (loggedIn) {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║  R1 Telegram — ready on :${PORT}     ✓ logged in
╚══════════════════════════════════════════════════════════════╝

Local URL:   ${localUrl}

Expose publicly (in a second terminal):
  cloudflared tunnel --url http://localhost:${PORT}

Then take the https://<subdomain>.trycloudflare.com/${tokenQS} URL,
paste it into https://boondit.site/r1-generator, and scan the QR
with your R1.
`);
    } else {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║  R1 Telegram — ready on :${PORT}     ⧗ not logged in
╚══════════════════════════════════════════════════════════════╝

Log in one of two ways:

  A) Terminal (recommended):
       npm run setup

  B) Browser (power-user fallback):
       ${localUrl}
`);
    }
  });
})();
