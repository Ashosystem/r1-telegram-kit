# R1 Telegram

Browse and reply to your Telegram chats using voice on the Rabbit R1.

```
┌──────────────────┐       HTTPS / WS         ┌──────────────────────┐
│   Rabbit R1      │ ◄──────────────────────► │   Hosted Backend     │
│   240×282 WebView│                          │   (Node.js + GramJS) │
│   + PTT button   │   REST: /chats /send     │   Holds TG session   │
│   + Scroll wheel │   WS:  live messages     │   Calls MTProto API  │
│   + TTS speaker  │   TTS: /tts              │   OpenAI TTS opt.    │
└──────────────────┘                          └──────────────────────┘
```

## Features

- Browse all your Telegram chats (groups, DMs, channels)
- Scroll with the R1 wheel, tap or use PTT to open chats
- Voice-to-text replies using R1's onboard STT (PTT button → speak → confirm)
- Text-to-speech: incoming messages spoken aloud via R1's native speaker
- Unread badges and mark-as-read
- Real-time message push via WebSocket
- Works with any Telegram user account (not limited to bots)

## Project Structure

```
r1-telegram/
├── .env.example      # Environment template — copy to .env and fill in
├── package.json      # Dependencies + npm scripts
├── setup-auth.js     # One-time Telegram login (generates session string)
├── server.js         # Express + WebSocket + GramJS backend
├── index.html        # Single-file R1 creation (all UI + logic)
├── harness.html      # Browser dev/testing harness
├── tunnel.js         # Cloudflare tunnel helper for local testing
└── Dockerfile        # Container deployment
```

---

## Setup

### 1. Get Telegram API Credentials

Go to [my.telegram.org/apps](https://my.telegram.org/apps), log in, and create an application. Note your **API ID** and **API Hash**.

### 2. Configure the Backend

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
R1_AUTH_TOKEN=some-random-secret-string
PORT=3000

# Optional: enables server-side TTS fallback (not needed on R1 — native speaker used instead)
OPENAI_API_KEY=
```

`R1_AUTH_TOKEN` is a secret you choose — it prevents anyone else from using your backend. Use any random string.

### 3. Install Dependencies & Authenticate

```bash
npm install
npm run setup
```

This prompts for your Telegram phone number and OTP code. On success it prints a `TELEGRAM_SESSION=...` line — paste that into your `.env`.

### 4. Start the Server

```bash
npm start
```

You should see:

```
Telegram client connected.
R1 Telegram backend listening on :3000
```

### 5. Deploy to HTTPS

The R1 requires HTTPS. Options:

| Host | Notes |
|------|-------|
| **Railway** | Connect repo → auto-deploy |
| **Render** | Web Service → Node → `npm start` |
| **Fly.io** | `fly launch` → `fly deploy` |
| **VPS** | Use the included Dockerfile, put behind Caddy/nginx with TLS |

For quick local testing, use `node tunnel.js` (requires [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).

### 6. Install the Creation on R1

The creation URL is:

```
https://your-backend.com/index.html?backend=https://your-backend.com&token=your-auth-token
```

If you're hosting `index.html` separately (e.g. GitHub Pages):

```
https://your-static-host.com/index.html?backend=https://your-backend.com&token=your-auth-token
```

Generate a QR code from that URL and scan it with your R1 to install.

---

## R1 Controls

| Control | Chat List | Chat View | Confirm |
|---------|-----------|-----------|---------|
| **Scroll wheel** | Navigate up/down | Scroll messages | Toggle Cancel/Send |
| **PTT press** | Open selected chat | Start recording | — |
| **PTT release** | — | Stop recording → confirm send | — |
| **Tap** | Open tapped chat | — | Tap Cancel or Send |
| **🔇/🔊 button** | — | Toggle text-to-speech | — |

---

## Text-to-Speech

When TTS is enabled (🔊), incoming messages are spoken aloud through the R1's speaker.

On R1: uses the native `PluginMessageHandler` bridge — no API key needed.  
On desktop/browser: falls back to server-side OpenAI TTS (requires `OPENAI_API_KEY`), then browser `speechSynthesis`.

---

## API Reference

All endpoints require the `X-Auth-Token` header matching `R1_AUTH_TOKEN`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | `{ ok: true, telegram: true/false }` |
| `/chats` | GET | List recent dialogs |
| `/chats/:id/messages` | GET | Messages for a chat (`?limit=20`) |
| `/chats/:id/send` | POST | Send `{ text: "..." }` |
| `/chats/:id/read` | POST | Mark chat as read |
| `/stt` | POST | Speech-to-text (multipart audio, returns `{ text }`) |
| `/tts` | POST | Text-to-speech (sends `{ text }`, returns `audio/mpeg`) |
| `/ws` | WebSocket | Real-time `{ type: "new_message", chatId, message }` events |

---

## Development

Open `harness.html` in a browser for a testing UI with mocked R1 controls.

To test the creation itself in a 240×282 browser window, keyboard controls:

- **Space** = PTT (hold to record, release to stop)
- **Arrow Up/Down** = Scroll wheel
- **Enter** = Select / confirm
- **Escape** = Back

---

## License

MIT
