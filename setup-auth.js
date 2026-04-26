#!/usr/bin/env node
/**
 * setup-auth.js
 * 
 * Run this ONCE on your desktop/laptop to authenticate with Telegram.
 * It will prompt for your phone number + OTP code, then print a session
 * string you paste into .env as TELEGRAM_SESSION.
 *
 * Usage:
 *   cp .env.example .env        # fill in API_ID and API_HASH first
 *   npm install
 *   npm run setup
 */

import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
  console.error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first.');
  process.exit(1);
}

const session = new StringSession('');
const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

(async () => {
  console.log('\n=== Telegram Login ===\n');

  await client.start({
    phoneNumber: async () => await ask('Phone number (with country code): '),
    password: async () => await ask('2FA password (if enabled): '),
    phoneCode: async () => await ask('OTP code from Telegram: '),
    onError: (err) => console.error('Auth error:', err.message),
  });

  const sessionString = client.session.save();

  console.log('\n=== Success! ===');
  console.log('Add this line to your .env file:\n');
  console.log(`TELEGRAM_SESSION=${sessionString}`);
  console.log('\nThen start the server with: npm start\n');

  await client.disconnect();
  rl.close();
})();
