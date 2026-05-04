# R1 Telegram

Browse and reply to your Telegram chats using voice or keyboard on the Rabbit R1.

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
- Keyboard text input: tap ⌨️ to open a compose screen and type a message with the onboard keyboard
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

You will need:
- A computer running **macOS, Linux, or Windows** with internet access
- **Node.js** (version 18 or later) — download from [nodejs.org](https://nodejs.org) if you don't have it
- A **Telegram account** (the one you want to read on the R1)
- Somewhere to host the backend over HTTPS (see Step 5)

---

### Step 1 — Download the code

Open a terminal:
- **macOS**: press `Cmd + Space`, type `Terminal`, press Enter
- **Windows**: press `Win + R`, type `cmd`, press Enter (or use [Windows Terminal](https://aka.ms/terminal))
- **Linux**: open your terminal application

Run these commands one at a time, pressing Enter after each:

```bash
git clone https://github.com/Ashosystem/r1-telegram-kit.git
cd r1-telegram-kit
```

> **No git?** Download the ZIP instead: click the green **Code** button on GitHub → **Download ZIP** → unzip it → open your terminal and `cd` into the unzipped folder.
>
> Example on macOS/Linux (adjust the folder name if needed):
> ```bash
> cd ~/Downloads/r1-telegram-kit-main
> ```
> On Windows:
> ```
> cd C:\Users\YourName\Downloads\r1-telegram-kit-main
> ```

---

### Step 2 — Get Telegram API credentials

1. Go to [my.telegram.org/apps](https://my.telegram.org/apps) in a browser
2. Log in with the phone number of the Telegram account you want to use on the R1
3. Click **Create new application** (fill in any name and description — it doesn't matter)
4. Copy your **App api_id** (a number, e.g. `12345678`) and **App api_hash** (a long string)

Keep this browser tab open — you'll need these values in the next step.

---

### Step 3 — Configure your environment file

In your terminal (make sure you're still inside the `r1-telegram-kit` folder), run:

```bash
cp .env.example .env
```

Now open the `.env` file in a text editor. On macOS you can run:

```bash
open -e .env
```

On Windows:

```
notepad .env
```

On Linux:

```bash
nano .env
```

You'll see this:

```
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_SESSION=
R1_AUTH_TOKEN=change-me-to-something-random
PORT=3000
OPENAI_API_KEY=
```

Fill it in:

| Field | What to put |
|-------|-------------|
| `TELEGRAM_API_ID` | The App api_id number from Step 2 |
| `TELEGRAM_API_HASH` | The App api_hash string from Step 2 |
| `TELEGRAM_SESSION` | Leave blank for now — you'll fill this in after Step 4 |
| `R1_AUTH_TOKEN` | Make up any password, e.g. `my-secret-123`. This stops others from using your backend. |
| `PORT` | Leave as `3000` |
| `OPENAI_API_KEY` | Optional — only needed for TTS on desktop. Leave blank if you don't have one. |

Save and close the file.

---

### Step 4 — Install dependencies and log in to Telegram

In your terminal, run:

```bash
npm install
```

This downloads the required packages. It may take a minute. When it finishes, run:

```bash
npm run setup
```

You'll be asked for your Telegram phone number (include the country code, e.g. `+447700900000`). Enter it and press Enter. Telegram will send you a confirmation code — enter that too.

On success you'll see a line like:

```
TELEGRAM_SESSION=1BVtsOKABu3Q...
```

Copy the entire value after `TELEGRAM_SESSION=` and paste it into your `.env` file on the `TELEGRAM_SESSION=` line. Save the file.

---

### Step 5 — Start the server

```bash
npm start
```

You should see:

```
Telegram client connected.
R1 Telegram backend listening on :3000
```

Your backend is now running locally on port 3000. Keep this terminal window open.

**The R1 requires HTTPS**, so you need to expose your backend over a secure URL. The easiest options:

#### Option A — Quick test with a tunnel (no account needed)

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) then, in a **second** terminal window:

```bash
node tunnel.js
```

This prints a temporary `https://...trycloudflare.com` URL. Use that as your backend URL in Step 6. Note: the URL changes every time you restart.

#### Option B — Permanent hosting (recommended)

| Platform | How |
|----------|-----|
| **Railway** | Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → it auto-detects Node and deploys |
| **Render** | Go to [render.com](https://render.com) → New Web Service → connect your GitHub repo → set Start Command to `npm start` |
| **Fly.io** | Install the [flyctl CLI](https://fly.io/docs/hands-on/install-flyctl/) → `fly launch` → `fly deploy` |
| **VPS** (recommended for always-on) | Rent a small VPS (e.g. [Hetzner](https://www.hetzner.com/cloud), [DigitalOcean](https://www.digitalocean.com), [Linode](https://www.linode.com)) — a €4/month instance is plenty. SSH in, clone the repo, run `npm install && npm start` under a process manager like [PM2](https://pm2.keymetrics.io/) (`npm install -g pm2 && pm2 start server.js --name r1-telegram`), and put it behind [Caddy](https://caddyserver.com/) for automatic HTTPS. Your backend runs 24/7 and survives reboots. |

After deploying, copy the HTTPS URL the platform gives you (e.g. `https://r1-telegram.up.railway.app`). You'll use it in Step 6.

> When deploying to a platform, add your `.env` values as **environment variables** in the platform's dashboard — don't upload the `.env` file itself.

---

### Step 6 — Install the creation on your R1

Construct your creation URL:

```
https://YOUR-BACKEND-URL/index.html?backend=https://YOUR-BACKEND-URL&token=YOUR-AUTH-TOKEN
```

Replace `YOUR-BACKEND-URL` with the HTTPS URL from Step 5, and `YOUR-AUTH-TOKEN` with the `R1_AUTH_TOKEN` value you set in Step 3.

**Example:**
```
https://r1-telegram.up.railway.app/index.html?backend=https://r1-telegram.up.railway.app&token=my-secret-123
```

Go to [boondit.site/r1-generator](https://boondit.site/r1-generator), paste in your URL, and generate a QR code. Scan it with your R1 to install the creation.

---

## R1 Controls

| Control | Chat List | Chat View | Compose | Confirm |
|---------|-----------|-----------|---------|---------|
| **Scroll wheel** | Navigate up/down | Scroll messages | — | Toggle Cancel/Send |
| **PTT press** | Open selected chat | Start recording | — | — |
| **PTT release** | — | Stop recording → confirm send | — | — |
| **Tap** | Open tapped chat | — | Tap textarea, type, tap Send | Tap Cancel or Send |
| **⌨️ button** | — | Open compose screen | — | — |
| **🔇/🔊 button** | — | Toggle text-to-speech | — | — |

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

- **Space** = PTT (hold to record, release to stop) — in compose screen, all keys pass directly to the textarea
- **Arrow Up/Down** = Scroll wheel
- **Enter** = Select / confirm
- **Escape** = Back

---

## License

MIT
