// scripts/setup.js — one-time CLI login.
//
// Prompts for phone number, Telegram code, and 2FA password (if enabled),
// then writes the resulting TELEGRAM_SESSION string back to .env so that
// `npm start` can pick it up.
//
// Run: `npm run setup` from the project root.

import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import readline from 'node:readline/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = join(__dirname, '..', '.env');

// ─── Sanity checks ──────────────────────────────────────────────────
const API_ID   = parseInt(process.env.TELEGRAM_API_ID, 10);
const API_HASH = process.env.TELEGRAM_API_HASH;

if (!API_ID || !API_HASH) {
  console.error(`
❌ Missing TELEGRAM_API_ID or TELEGRAM_API_HASH.

Get them from https://my.telegram.org and add them to .env first:

    TELEGRAM_API_ID=12345678
    TELEGRAM_API_HASH=abcd1234abcd1234abcd1234abcd1234

Then re-run: npm run setup
`);
  process.exit(1);
}

if (process.env.TELEGRAM_SESSION?.trim()) {
  console.log(`
ℹ  TELEGRAM_SESSION is already set in .env.

If you want to log in as a different account, delete the TELEGRAM_SESSION
line from .env and re-run this script. Otherwise just run: npm start
`);
  process.exit(0);
}

// ─── Prompt helpers ─────────────────────────────────────────────────
const rl = readline.createInterface({ input, output });

const ask = async (q) => (await rl.question(q)).trim();

// ─── Log in ─────────────────────────────────────────────────────────
console.log(`
R1 Telegram — one-time setup.

You'll be asked for:
  • Your phone number (with country code, e.g. +441234567890)
  • The 5-digit code Telegram sends you
  • Your 2FA password, if you have one set (optional)
`);

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
  connectionRetries: 5,
});

try {
  await client.start({
    phoneNumber: async () => await ask('Phone (with country code): '),
    phoneCode:   async () => await ask('Login code from Telegram: '),
    password:    async () => await ask('2FA password (press Enter if none): '),
    onError:     (err) => console.error('Login error:', err.errorMessage || err.message),
  });
} catch (err) {
  console.error('\n❌ Login failed:', err.errorMessage || err.message);
  await client.disconnect().catch(() => {});
  rl.close();
  process.exit(1);
}

const sessionStr = client.session.save();

// ─── Write to .env ──────────────────────────────────────────────────
let env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
if (/^TELEGRAM_SESSION\s*=.*$/m.test(env)) {
  env = env.replace(/^TELEGRAM_SESSION\s*=.*$/m, `TELEGRAM_SESSION=${sessionStr}`);
} else {
  if (env.length && !env.endsWith('\n')) env += '\n';
  env += `TELEGRAM_SESSION=${sessionStr}\n`;
}
writeFileSync(ENV_PATH, env);

// ─── Done ───────────────────────────────────────────────────────────
try {
  const me = await client.getMe();
  console.log(`\n✓ Logged in as ${me.firstName || me.username || me.id}.`);
} catch {
  console.log('\n✓ Logged in.');
}
console.log(`✓ Session saved to ${ENV_PATH}.\n\nNext: npm start\n`);

await client.disconnect();
rl.close();
process.exit(0);
