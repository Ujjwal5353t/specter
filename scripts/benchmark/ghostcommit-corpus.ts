// GhostCommit labelled corpus: synthetic commits whose added lines are each
// labelled as a planted secret or as clean.
//
// Every "secret" here is fake. Values are generated at runtime from a fixed
// seed, and vendor prefixes are split across string concatenations, so this
// file contains no literal token. That keeps GitHub push protection from
// blocking it and keeps SPECTER from flagging its own repository.
//
// The corpus deliberately includes cases a regex + entropy scanner is expected
// to get wrong (unstructured passwords, hex secrets, look-alike hashes), so the
// numbers it produces describe the scanner honestly rather than flatteringly.

export type LineLabel =
  | { label: 'secret'; kind: 'vendor' | 'unstructured'; what: string }
  | { label: 'clean'; hard?: string };

export interface CorpusLine { text: string; tag: LineLabel }
export interface CorpusFile { filename: string; lines: CorpusLine[] }
export interface CorpusCommit { sha: string; message: string; files: CorpusFile[] }

/** mulberry32: deterministic, so the corpus (and the numbers) are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(8);
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER_NUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HEX = '0123456789abcdef';
const B64 = ALNUM + '+/';
const B64URL = ALNUM + '-_';
const rand = (n: number, set = ALNUM) => Array.from({ length: n }, () => set[Math.floor(R() * set.length)]).join('');

// Vendor prefixes, split so no literal token appears in source.
const P = {
  aws: 'AK' + 'IA',
  gh: 'gh' + 'p_',
  ghs: 'gh' + 's_',
  stripe: 'sk_' + 'live_',
  openai: 'sk' + '-',
  openaiProj: 'sk' + '-proj-',
  anthropic: 'sk' + '-ant-api03-',
  slack: 'xo' + 'xb-',
  google: 'AI' + 'za',
  npm: 'np' + 'm_',
  sendgrid: 'S' + 'G.',
  pemPriv: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  pemPub: '-----BEGIN ' + 'PUBLIC KEY-----',
};

const secret = (text: string, kind: 'vendor' | 'unstructured', what: string): CorpusLine =>
  ({ text, tag: { label: 'secret', kind, what } });
const clean = (text: string, hard?: string): CorpusLine => ({ text, tag: { label: 'clean', hard } });

const jwt = () =>
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + rand(60, B64URL) + '.' + rand(43, B64URL);

// ── Ordinary code: the bulk of what a scanner reads ──────────────────────
const ORDINARY: string[] = [
  "import { useState, useEffect } from 'react';",
  "import type { NextRequest } from 'next/server';",
  'export async function GET(req: NextRequest) {',
  "  const { searchParams } = new URL(req.url);",
  "  const page = Number(searchParams.get('page') ?? '1');",
  '  if (!Number.isFinite(page) || page < 1) {',
  "    return Response.json({ error: 'invalid page' }, { status: 400 });",
  '  }',
  '  const rows = await db.select().from(users).limit(20).offset((page - 1) * 20);',
  '  return Response.json({ rows, page });',
  '}',
  'function handleUserAuthenticationTokenRefreshCallback(event) {',
  '  // Refresh the session a minute before it expires.',
  '  const expiresInMs = event.expiresAt - Date.now() - 60_000;',
  '  setTimeout(() => refreshSession(event.userId), Math.max(0, expiresInMs));',
  '}',
  "const className = 'flex items-center justify-between gap-4 rounded-lg px-3 py-2';",
  "const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';",
  "const token = process.env.GITHUB_TOKEN;",
  "const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });",
  "logger.info('scan finished', { scanId, durationMs: Date.now() - startedAt });",
  "throw new Error('Repository not found or not accessible with the configured token');",
  '  "name": "specter-dashboard",',
  '  "version": "2.4.1",',
  '  "typescript": "^5.6.3",',
  'services:',
  '  web:',
  '    image: node:20-alpine',
  '    command: npm run start',
  '## Getting started',
  'Run `npm install` and then `npm run dev` to start the development server.',
  'SELECT id, email, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC;',
];

export function buildCorpus(): CorpusCommit[] {
  const sha = () => rand(40, HEX);
  return [
    {
      sha: sha(),
      message: 'feat: add paginated users endpoint',
      files: [
        { filename: 'src/app/api/users/route.ts', lines: ORDINARY.slice(0, 16).map((t) => clean(t)) },
        { filename: 'src/components/Toolbar.tsx', lines: ORDINARY.slice(16, 22).map((t) => clean(t)) },
      ],
    },
    {
      sha: sha(),
      message: 'chore: wire up cloud credentials',
      files: [
        {
          filename: 'src/config/aws.ts',
          lines: [
            clean("import { S3Client } from '@aws-sdk/client-s3';"),
            secret(`const accessKeyId = '${P.aws}${rand(16, UPPER_NUM)}';`, 'vendor', 'AWS access key id'),
            secret(`const secretAccessKey = '${rand(40, B64)}';`, 'vendor', 'AWS secret access key'),
            clean("export const s3 = new S3Client({ region: 'eu-west-1', credentials: { accessKeyId, secretAccessKey } });"),
          ],
        },
        {
          filename: '.env',
          lines: [
            clean('NODE_ENV=production'),
            secret(`aws_secret_access_key=${rand(40, B64)}`, 'vendor', 'AWS secret access key (credentials-file form)'),
            secret(`GITHUB_TOKEN=${P.gh}${rand(36)}`, 'vendor', 'GitHub personal access token'),
            secret(`STRIPE_SECRET_KEY=${P.stripe}${rand(24)}`, 'vendor', 'Stripe live secret key'),
            secret(`OPENAI_API_KEY=${P.openai}${rand(48)}`, 'vendor', 'OpenAI key (legacy format)'),
            secret(`OPENAI_API_KEY=${P.openaiProj}${rand(74, B64URL)}T3BlbkFJ${rand(74, B64URL)}`, 'vendor', 'OpenAI project key (current format)'),
            secret(`ANTHROPIC_API_KEY=${P.anthropic}${rand(93, B64URL)}-${rand(6, ALNUM)}AA`, 'vendor', 'Anthropic API key'),
            secret(`SLACK_BOT_TOKEN=${P.slack}${rand(12, '0123456789')}-${rand(13, '0123456789')}-${rand(24)}`, 'vendor', 'Slack bot token'),
            secret(`DATABASE_URL=postgres://app_user:${rand(18)}@db.internal.example:5432/app`, 'vendor', 'Postgres URL with password'),
            secret(`GOOGLE_MAPS_KEY=${P.google}${rand(35, B64URL)}`, 'vendor', 'Google API key'),
            secret(`NPM_TOKEN=${P.npm}${rand(36)}`, 'vendor', 'npm automation token'),
            secret(`SENDGRID_API_KEY=${P.sendgrid}${rand(22, B64URL)}.${rand(43, B64URL)}`, 'vendor', 'SendGrid API key'),
            secret(`SESSION_SECRET=${rand(44, B64)}`, 'unstructured', 'random base64 session secret'),
            secret(`WEBHOOK_SECRET=${rand(64, HEX)}`, 'unstructured', 'hex-encoded webhook secret'),
            secret(`TWILIO_AUTH_TOKEN=${rand(32, HEX)}`, 'unstructured', 'Twilio auth token (32 hex)'),
            secret('DB_PASSWORD=Winter2024!Prod', 'unstructured', 'human-chosen password'),
            secret('ADMIN_PASSWORD=correcthorsebatterystaple', 'unstructured', 'passphrase'),
          ],
        },
      ],
    },
    {
      sha: sha(),
      message: 'ci: deploy workflow and test fixtures',
      files: [
        {
          filename: '.github/workflows/deploy.yml',
          lines: [
            clean('name: deploy'),
            clean('on: [push]'),
            clean('jobs:'),
            clean('  deploy:'),
            clean('    runs-on: ubuntu-latest'),
            secret(`      GH_TOKEN: ${P.ghs}${rand(36)}`, 'vendor', 'GitHub app installation token'),
            secret(`      api_key: "${rand(32)}"`, 'vendor', 'generic api_key assignment'),
            clean('      - uses: actions/checkout@v4'),
          ],
        },
        {
          filename: 'test/fixtures/auth.ts',
          lines: [
            secret(`export const serviceToken = '${jwt()}';`, 'vendor', 'JWT bearer token'),
            clean("export const userId = '3f1c9a52-7b4e-4d2a-9c8f-1e6b2a7d4c90';", 'UUID'),
          ],
        },
        {
          filename: 'deploy/id_rsa',
          lines: [
            secret(P.pemPriv, 'vendor', 'PEM private key header'),
            secret(rand(64, B64), 'vendor', 'PEM private key body'),
            secret(rand(64, B64), 'vendor', 'PEM private key body'),
            secret(rand(64, B64), 'vendor', 'PEM private key body'),
          ],
        },
      ],
    },
    {
      sha: sha(),
      message: 'docs: config examples, public key, shrinkwrap',
      files: [
        {
          filename: '.env.example',
          lines: [
            clean('STRIPE_SECRET_KEY=sk_test_replace_me', 'placeholder'),
            // Split so the placeholder doesn't trip SPECTER's own api_key rule.
            clean('API_' + 'KEY=your_api_key_goes_here_xxxxxxxx', 'placeholder'),
            clean('DATABASE_URL=postgres://user:password@localhost:5432/dev', 'placeholder'),
          ],
        },
        {
          filename: 'docs/aws.md',
          lines: [
            clean('Use the documented example credentials when testing locally:'),
            clean(`    aws_access_key_id = ${P.aws}IOSFODNN7EXAMPLE`, 'AWS documentation example key'),
          ],
        },
        {
          filename: 'keys/jwt-public.pem',
          lines: [
            clean(P.pemPub, 'public key header'),
            clean(rand(64, B64), 'public key body (not secret)'),
            clean(rand(64, B64), 'public key body (not secret)'),
          ],
        },
        {
          filename: 'npm-shrinkwrap.json',
          lines: [
            clean('    "node_modules/semver": {'),
            clean('      "version": "7.6.3",'),
            clean(`      "integrity": "sha512-${rand(86, B64)}==",`, 'package integrity hash'),
            clean(`      "integrity": "sha512-${rand(86, B64)}==",`, 'package integrity hash'),
          ],
        },
        {
          filename: 'public/index.html',
          lines: [
            clean(`<script src="https://cdn.example.com/lib.js" integrity="sha384-${rand(64, B64)}" crossorigin="anonymous"></script>`, 'subresource integrity hash'),
            clean(`<link rel="icon" href="data:image/png;base64,${rand(96, B64)}">`, 'inline base64 image'),
          ],
        },
        {
          filename: 'src/lib/cache.ts',
          lines: [
            clean(`const BUILD_SHA = '${rand(40, HEX)}';`, 'git commit SHA'),
            clean(`const ASSET_HASH = '${rand(32, HEX)}';`, 'content hash (hex)'),
            clean(`const etag = 'W/"${rand(27, B64URL)}"';`, 'ETag'),
          ],
        },
        { filename: 'README.md', lines: ORDINARY.slice(22).map((t) => clean(t)) },
      ],
    },
  ];
}

/** Renders a file's lines as the unified-diff patch GitHub returns for an added file. */
export function toPatch(lines: CorpusLine[]): string {
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l.text}`)].join('\n');
}
