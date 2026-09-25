# SPECTER scanner benchmark

Generated 2026-09-25 by `npm run benchmark`. DepChain results depend on OSV.dev's live data and can change as advisories are published; GhostCommit results are fully deterministic.

## DepChain (known CVEs via npm registry + OSV.dev)

12 packages, each pinned to a version with a known advisory and to the release that fixed it (24 package versions).

| Metric | Result |
| --- | --- |
| Labelled advisory detected on the vulnerable version | **12/12 (100.0%)** |
| Labelled advisory reported on the patched version (false positive) | **0/12** |
| Advisories reported that OSV does not list for that exact version | **0** |
| All OSV advisories for the exact version found (recall vs OSV) | 81/81 (100.0%) |
| Package versions where DepChain matches OSV exactly | 24/24 |
| Clean controls (versions with no advisories) reported clean | 7/7 |
| Pinned version resolved correctly from the registry | 24/24 |

| Package | Vulnerable → patched | Labelled advisory | Detected | On patched | Other advisories still on patched |
| --- | --- | --- | --- | --- | --- |
| minimist | 1.2.5 → 1.2.6 | GHSA-xvch-5gv4-984h (prototype pollution (CVE-2021-44906)) | yes | no | 0 |
| lodash | 4.17.20 → 4.17.21 | GHSA-35jh-r3h4-6jhm (command injection in template (CVE-2021-23337)) | yes | no | 3 |
| event-stream | 3.3.6 → 4.0.1 | GHSA-mh6f-8j2x-4483 (malicious flatmap-stream payload (2018)) | yes | no | 0 |
| ua-parser-js | 0.7.29 → 0.7.30 | GHSA-pjwm-rvh2-c87w (hijacked release ships cryptominer (CVE-2021-4229)) | yes | no | 1 |
| node-ipc | 10.1.1 → 10.1.3 | GHSA-97m3-w2cp-4xx6 (protestware overwrites files (CVE-2022-23812)) | yes | no | 0 |
| axios | 0.21.0 → 0.21.1 | GHSA-4w2v-q235-vp99 (SSRF via redirect (CVE-2020-28168)) | yes | no | 24 |
| node-fetch | 2.6.0 → 2.6.7 | GHSA-r683-j2x4-v87g (forwards secure headers on redirect (CVE-2022-0235)) | yes | no | 0 |
| jsonwebtoken | 8.5.1 → 9.0.0 | GHSA-8cf7-32gw-wr33 (unrestricted key type (CVE-2022-23539)) | yes | no | 0 |
| semver | 7.5.1 → 7.5.2 | GHSA-c2qf-rxjj-qqgw (ReDoS in range parsing (CVE-2022-25883)) | yes | no | 0 |
| ws | 7.4.5 → 7.4.6 | GHSA-6fc8-4gx4-v693 (ReDoS in Sec-Websocket-Protocol (CVE-2021-32640)) | yes | no | 2 |
| json5 | 2.2.1 → 2.2.2 | GHSA-9c47-m6qq-7p4h (prototype pollution in parse (CVE-2022-46175)) | yes | no | 0 |
| qs | 6.10.2 → 6.10.3 | GHSA-hrpp-h998-j3pp (prototype pollution (CVE-2022-24999)) | yes | no | 3 |

No discrepancies against OSV.

Some "patched" releases still carry later, unrelated advisories (listed in the last column). Those are correct findings, not false positives.

Scope: this verifies that DepChain resolves pinned versions and reports what OSV.dev knows, with nothing invented or misattributed. It does not measure detection of undisclosed (zero-day) compromises; DepChain can only report what OSV has catalogued.

## GhostCommit (secrets in commit diffs)

Labelled corpus of 4 synthetic commits: 25 lines with planted fake secrets and 59 clean lines, 15 of them hard negatives that look like secrets (hashes, public keys, placeholders). Values are generated from a fixed seed, so runs are reproducible. A secret counts as detected if its line is flagged at all.

| Metric | Result |
| --- | --- |
| Recall, all planted secrets | **21/25 (84.0%)** |
| Recall, vendor-format secrets (known prefix or shape) | 19/20 (95.0%) |
| Recall, unstructured secrets (passwords, hex, random strings) | 2/5 (40.0%) |
| False-positive rate, all clean lines | **10/59 (16.9%)** |
| False-positive rate, hard negatives only | 10/15 (66.7%) |
| Precision (flagged lines that really are secrets) | 21/31 (67.7%) |

| Planted secret | Kind | Detected |
| --- | --- | --- |
| AWS access key id | vendor | yes (AWS Access Key) |
| AWS secret access key | vendor | yes (High-entropy string) |
| AWS secret access key (credentials-file form) | vendor | yes (High-entropy string) |
| GitHub personal access token | vendor | yes (GitHub Token) |
| Stripe live secret key | vendor | yes (Stripe Secret Key, Generic API Key) |
| OpenAI key (legacy format) | vendor | yes (OpenAI Key, Generic API Key) |
| OpenAI project key (current format) | vendor | yes (Generic API Key) |
| Anthropic API key | vendor | yes (Anthropic Key, Generic API Key) |
| Slack bot token | vendor | yes (Slack Token) |
| Postgres URL with password | vendor | yes (Database URL) |
| Google API key | vendor | yes (High-entropy string) |
| npm automation token | vendor | yes (High-entropy string) |
| SendGrid API key | vendor | **missed** |
| random base64 session secret | unstructured | yes (High-entropy string) |
| hex-encoded webhook secret | unstructured | **missed** |
| Twilio auth token (32 hex) | unstructured | yes (Generic API Key) |
| human-chosen password | unstructured | **missed** |
| passphrase | unstructured | **missed** |
| GitHub app installation token | vendor | yes (GitHub Token) |
| generic api_key assignment | vendor | yes (Generic API Key) |
| JWT bearer token | vendor | yes (JWT Token) |
| PEM private key header | vendor | yes (Private Key Block) |
| PEM private key body | vendor | yes (High-entropy string) |
| PEM private key body | vendor | yes (High-entropy string) |
| PEM private key body | vendor | yes (High-entropy string) |

| False positive | File | Flagged as |
| --- | --- | --- |
| placeholder | `.env.example` | Generic API Key |
| placeholder | `.env.example` | Database URL |
| AWS documentation example key | `docs/aws.md` | AWS Access Key |
| public key body (not secret) | `keys/jwt-public.pem` | High-entropy string |
| public key body (not secret) | `keys/jwt-public.pem` | High-entropy string |
| package integrity hash | `npm-shrinkwrap.json` | High-entropy string |
| package integrity hash | `npm-shrinkwrap.json` | High-entropy string |
| subresource integrity hash | `public/index.html` | High-entropy string |
| inline base64 image | `public/index.html` | High-entropy string |
| ETag | `src/lib/cache.ts` | High-entropy string |
