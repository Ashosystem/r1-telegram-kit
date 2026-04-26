// Quick tunnel helper — useful for testing without a domain.
// Requires cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
//
// Usage:
//   node tunnel.js          (creates a temporary public URL for port 3000)
//
// For a persistent domain, run:
//   cloudflared tunnel --url http://localhost:3000

import { spawn } from 'child_process';

const proc = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3000'], {
  stdio: 'inherit',
});

proc.on('exit', (code) => process.exit(code));
