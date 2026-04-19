# r1-telegram

A self-hosted Telegram client for the [Rabbit R1](https://www.rabbit.tech/rabbit-r1). Runs on your own computer, exposed to the R1 over a public tunnel.

* No cloud account or subscription required
* Your Telegram session stays on your machine
* Scroll wheel navigation, PTT voice dictation, live message updates

**What you need:** Node.js 20+ · a Rabbit R1 · a Telegram account · a terminal · \~10 minutes

\---

## 

## Step 1 — Get Telegram API credentials

Visit [my.telegram.org](https://my.telegram.org) and log in with your phone number. Click **API Development Tools** and fill in the short form — the App title and Short name can be anything (e.g. "r1-telegram").

Copy down the two values it gives you:

* `App api\_id` — a short number, e.g. `12345678`
* `App api\_hash` — a long hex string

Keep these private. Don't share them or commit them to git.

\---

## 

## Step 2 — Unzip and open a terminal

Unzip `r1-telegram-kit.zip` somewhere convenient. Then open a terminal and navigate into the folder:

**macOS / Linux**

```bash
cd \~/Downloads/r1-telegram-kit
```

**Windows (PowerShell)**

```powershell
cd $HOME\\Downloads\\r1-telegram-kit
```

\---

## 

## Step 3 — Fill in your credentials

Copy the example env file:

**macOS / Linux**

```bash
cp .env.example .env
```

**Windows (PowerShell)**

```powershell
Copy-Item .env.example .env
```

Open `.env` in any text editor and fill in the two values from Step 1:

```
TELEGRAM\_API\_ID=12345678
TELEGRAM\_API\_HASH=abcd1234abcd1234abcd1234abcd1234
```

Leave everything else as-is for now.

\---


Step 4 — Install, log in, and start the server
---

**Install dependencies** (once only):

```bash
npm install
```

**Log in to Telegram** (once only):

```bash
npm run setup
```

You'll be prompted for your phone number (with country code, e.g. `+441234567890`), the code Telegram sends to your app, and your 2FA password if you have one. On success, your session is written to `.env` — you won't need to do this again unless you log out.

**Start the server:**

```bash
npm start
```

You'll see:

```
╔══════════════════════════════════════════════════════════════╗
║  R1 Telegram — ready on :3000     ✓ logged in
╚══════════════════════════════════════════════════════════════╝

Local URL:   http://localhost:3000/?token=abc123...
```

Keep this terminal running. Note the token in the URL — you'll need it in Step 6.

\---


Step 5 — Keep your files safe (optional but recommended)
---

Your `.env` file contains your API credentials and your session string. If you lose it, you'll need to re-run `npm run setup`. A few options:

* **Back up `.env`** to a password manager or encrypted drive. Never commit it to a public git repo — the `.gitignore` already excludes it, but double-check before pushing anywhere.
* **Run it from a permanent location** — move the whole folder somewhere stable (e.g. `\~/apps/r1-telegram`) rather than leaving it in Downloads, so it's still there when you next want to use it.
* **Pin your tunnel URL** — the default cloudflared quick tunnel gives you a different URL every restart, which means regenerating the R1 QR each time. If that's annoying, see [Running with a stable URL](#running-with-a-stable-url) below.

\---


Step 6 — Expose a public URL and install on the R1
---

The R1 is a cellular device — it can't reach `localhost`. You need to expose your local server with a tunnel.

**Install cloudflared:**

macOS: `brew install cloudflared`

Linux: download from [github.com/cloudflare/cloudflared/releases](https://github.com/cloudflare/cloudflared/releases) or `sudo apt install cloudflared`

Windows: `winget install --id Cloudflare.cloudflared`

**Start the tunnel** in a second terminal window (keep `npm start` running in the first):

```bash
cloudflared tunnel --url http://localhost:3000
```

Cloudflared will print a URL like:

```
https://random-words-1234.trycloudflare.com
```

**Build your R1 install URL** by appending the token from Step 4:

```
https://random-words-1234.trycloudflare.com/?token=abc123...
```

**Generate the QR:**

Open [boondit.site/r1-generator](https://boondit.site/r1-generator) in a browser and fill in:

* **Plugin Name** — `Telegram`
* **Theme Color** — `#2AABEE`
* **Website URL** — the full URL above including the token
* **Description** — anything

Scan the QR in full screen with your R1. Your chats will appear.

\---


Using the R1 controls
---

|Control|Action|
|-|-|
|Scroll wheel|Navigate chat list / scroll messages|
|Side button — short press|Select / open chat|
|Side button — long press|Hold to dictate, release to send|

\---


Running with a stable URL
---

The default cloudflared quick tunnel gives you a different URL every restart. To avoid regenerating the QR each time:

* **Named cloudflared tunnel** on a domain you own — [Cloudflare's guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Permanent URL, survives restarts.
* **Tailscale Funnel** — free, stable URL tied to your Tailscale account. Run `tailscale funnel 3000`.
* **Home server** — run on a Raspberry Pi or spare machine with `pm2 start server.js` or a systemd unit to keep it running in the background.

\---


Deploying to a cloud host instead
---

If you'd rather not leave your own machine running, you can deploy to any Node host (Fly.io, Render, a VPS, etc.):

1. Set `TELEGRAM\_API\_ID` and `TELEGRAM\_API\_HASH` as environment variables on your host. Leave `TELEGRAM\_SESSION` blank.
2. Deploy and find the auto-generated auth token in the server logs.
3. Open `https://your-host/?token=<token>` in a browser — you'll be prompted to log in through the app's login screen.
4. Continue from Step 6 with your host's public URL.

For session persistence across redeploys, mount a volume at `/data`, or copy the session string out of your host's filesystem into a `TELEGRAM\_SESSION` env var.

\---


Troubleshooting
---

**"Missing TELEGRAM\_API\_ID or TELEGRAM\_API\_HASH"** — `.env` isn't filled in or isn't in the project root. Make sure the file exists and contains both values.

**"FLOOD\_WAIT" during setup** — Telegram has rate-limited login attempts. Wait the number of seconds shown in the error and try again.

**R1 shows "Backend unreachable"** — the cloudflared tunnel has probably died or gone idle. Restart it, copy the new URL, and regenerate the QR at boondit.site.

**R1 shows the login screen unexpectedly** — your `.env` session was cleared or the Telegram session was revoked. Run `npm run setup` again.

**I want to log in as a different account** — delete the `TELEGRAM\_SESSION=...` line from `.env` and run `npm run setup` again.

**The setup prompt shows my 2FA password in plain text** — yes, the terminal doesn't mask the input. Run `history -c` (bash/zsh) or close and reopen the terminal afterwards if that concerns you.

\---


Under the hood
---

* [gramjs](https://github.com/gram-js/gramjs) — Telegram MTProto client
* Express + WebSocket — local server and live message push
* Vanilla HTML/CSS/JS frontend sized for the R1's 240×282 WebView
* Optional: set `OPENAI\_API\_KEY` in `.env` for Whisper STT fallback when testing on desktop

\---


License
---

MIT

