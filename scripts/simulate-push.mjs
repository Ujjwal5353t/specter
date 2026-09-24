// Sends a signed fake GitHub push event to the local webhook, to test
// monitoring + Telegram alerts without configuring a real GitHub webhook.
//
//   node scripts/simulate-push.mjs owner/repo [http://localhost:3000]
//
// Needs the dev server running and GITHUB_WEBHOOK_SECRET in .env.local (or .env).
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

// Same precedence as Next.js: .env.local wins over .env
const envFile = ['.env.local', '.env'].find((f) => existsSync(f));
if (!envFile) {
  console.error('No .env.local or .env found in the current directory. Copy .env.sample to .env.local and set GITHUB_WEBHOOK_SECRET.');
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}

const [fullName, base = 'http://localhost:3000'] = process.argv.slice(2);
if (!fullName?.includes('/')) {
  console.error('Usage: node scripts/simulate-push.mjs owner/repo [baseUrl]');
  process.exit(1);
}
if (!env.GITHUB_WEBHOOK_SECRET) {
  console.error(`GITHUB_WEBHOOK_SECRET is not set in ${envFile}`);
  process.exit(1);
}

const [owner, name] = fullName.split('/');
const sha = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
const body = JSON.stringify({
  ref: 'refs/heads/main',
  after: sha,
  deleted: false,
  pusher: { name: 'specter-test' },
  head_commit: { id: sha, message: 'Simulated push from scripts/simulate-push.mjs' },
  repository: { name, private: false, default_branch: 'main', owner: { login: owner } },
});
const signature = 'sha256=' + createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex');

const res = await fetch(`${base}/api/webhooks/github`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': signature },
  body,
});
console.log(res.status, await res.text());
