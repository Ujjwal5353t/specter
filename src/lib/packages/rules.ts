import type { Severity } from '@/types';

/*
 * Static rules for the tarball-diff tier. Each rule reads only the code a release
 * ADDED (or changed) compared with the previous version, as plain text, and either
 * returns a short evidence snippet or null. Nothing is ever executed.
 *
 * The input is attacker-controlled, so every pattern is written to run in linear
 * time: bounded quantifiers, no nested repetition, no backreferences.
 *
 * Rules are cheap yellow flags. Many are ordinary in legitimate code (child_process,
 * eval), which is why they only ever run on versions the metadata tier already
 * flagged, look at added lines only, and get weights by how specific they are.
 */

export interface RuleContext {
  /** Hostnames already referenced anywhere in the previous version. */
  prevHosts: Set<string>;
}

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  /** Evidence snippet when the rule fires on this file's added code, else null. */
  detect(text: string, ctx: RuleContext): string | null;
}

const EVIDENCE_LENGTH = 90;

/** One printable line around a match, safe to show or log. */
function snippet(text: string, index: number): string {
  return text
    .slice(Math.max(0, index - 10), index + EVIDENCE_LENGTH)
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const match = (re: RegExp, text: string): string | null => {
  const m = re.exec(text);
  return m ? snippet(text, m.index) : null;
};

// ── shared building blocks ───────────────────────────────────────────────

const CHILD_PROCESS = /\bchild_process\b/;
const EVAL = /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"`]/;
const COMPILE = /\._compile\s*\(/;
const BASE64 = /Buffer\.from\([^)\n]{1,200}['"]base64['"]\s*\)|\batob\s*\(/;
const DECIPHER = /\bcreateDecipher(?:iv)?\s*\(/;
const NETWORK_API = new RegExp(
  '\\bfetch\\s*\\(|XMLHttpRequest|new\\s+WebSocket|\\baxios\\b|\\bhttps?\\.(?:request|get)\\s*\\(' +
  '|require\\(\\s*[\'"](?:node:)?https?[\'"]\\s*\\)|\\bnet\\.(?:connect|createConnection)\\s*\\(' +
  '|\\bdns\\.(?:resolve|lookup)\\w*\\s*\\(|\\b(?:curl|wget|Invoke-WebRequest|iwr)\\b',
);
const GEO_OR_LOCALE = new RegExp(
  '\\b(?:ipgeolocation|ipinfo|ip-api|ipapi|geoip|freegeoip|ipwho|geojs)\\b|country_?(?:name|code)\\b' +
  '|resolvedOptions\\(\\)\\.timeZone|process\\.env\\.(?:LANG|LC_ALL|LC_MESSAGES|LANGUAGE)\\b' +
  '|navigator\\.language|\\bgetTimezoneOffset\\s*\\(',
  'i',
);
const DATE_GATE = /\bnew\s+Date\s*\([^)]{0,60}\)\s*\.\s*(?:getFullYear|getMonth|getDate|getTime|valueOf)\b|\bDate\.now\s*\(\s*\)\s*[<>]=?\s*\d/;
const DESTRUCTIVE = new RegExp(
  '\\b(?:unlink|unlinkSync|rmSync|rmdirSync|rimraf|truncate|truncateSync)\\s*\\(' +
  '|\\b(?:writeFileSync|writeFile|appendFileSync)\\s*\\(|fs\\.promises\\.(?:rm|unlink|writeFile)' +
  '|\\brm\\s+-rf?\\b|\\bdel\\s+/[fsq]\\b|\\bFormat-Volume\\b',
  'i',
);
const WRITE_OP = /\b(?:writeFileSync|writeFile|appendFileSync|copyFileSync|copyFile)\s*\(/;

// Hostnames: literal IPs and domains inside http(s)/ws(s) URLs
const URL_HOST = /\b(?:https?|wss?):\/\/((?:\d{1,3}\.){3}\d{1,3}|[a-z0-9](?:[a-z0-9.-]{0,60}[a-z0-9])?\.[a-z]{2,24})(?::\d+)?/gi;
const IP_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
// Hosts that show up in comments and docs constantly; never interesting on their own
const BENIGN_HOSTS = /(?:^|\.)(?:github\.com|githubusercontent\.com|npmjs\.(?:com|org)|nodejs\.org|w3\.org|json-schema\.org|mozilla\.org|opensource\.org|apache\.org|creativecommons\.org|ietf\.org|wikipedia\.org|stackoverflow\.com|mit-license\.org|gnu\.org|whatwg\.org|ecma-international\.org|localhost|example\.(?:com|org)|schemas\.microsoft\.com|yarnpkg\.com|typescriptlang\.org|unpkg\.com|jsdelivr\.net)$/i;
// Where stolen data usually goes: paste sites, webhooks, tunnels, request catchers
const EXFIL_HOSTS = /(?:^|\.)(?:pastebin\.com|paste\.ee|transfer\.sh|ngrok(?:-free)?\.(?:io|app|dev)|webhook\.site|requestbin\.\w+|pipedream\.net|discord(?:app)?\.com|api\.telegram\.org|burpcollaborator\.net|oast\.\w+|interact\.sh|canarytokens\.\w+|hooks\.slack\.com|ply\.gg|trycloudflare\.com)$/i;
// Services a program calls to learn where its victim is
const GEO_HOSTS = /(?:^|\.)(?:ipgeolocation\.io|ipinfo\.io|ip-api\.com|ipapi\.co|freegeoip\.\w+|geoiplookup\.\w+|ipwho\.is|geojs\.io|ipify\.org|ifconfig\.me|icanhazip\.com|checkip\.amazonaws\.com|api\.myip\.com)$/i;

/** Hostnames mentioned in URLs in `text`. */
export function hostsIn(text: string): Set<string> {
  const hosts = new Set<string>();
  for (const m of text.matchAll(URL_HOST)) hosts.add(m[1].toLowerCase());
  return hosts;
}

const newHosts = (text: string, ctx: RuleContext) =>
  [...hostsIn(text)].filter((h) => !ctx.prevHosts.has(h) && !BENIGN_HOSTS.test(h));

const count = (re: RegExp, text: string) => {
  return [...text.matchAll(re)].length;
};

// ── the rules ────────────────────────────────────────────────────────────

export const RULES: Rule[] = [
  {
    id: 'child_process',
    title: 'Starts other programs (child_process)',
    severity: 'low',
    detect: (t) => match(CHILD_PROCESS, t),
  },
  {
    id: 'shell_download_exec',
    title: 'Downloads and runs a script from the shell',
    severity: 'high',
    detect: (t) => match(/\b(?:curl|wget)\b[^\n|]{0,100}\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b|powershell[^\n]{0,100}(?:-enc\w*|\biex\b|invoke-expression|downloadstring)/i, t),
  },
  {
    id: 'dynamic_eval',
    title: 'Runs code built at runtime (eval / new Function)',
    severity: 'medium',
    detect: (t) => match(EVAL, t),
  },
  {
    id: 'compile_from_string',
    title: 'Compiles a module from a string (module._compile)',
    severity: 'high',
    detect: (t) => match(COMPILE, t),
  },
  {
    id: 'base64_decode',
    title: 'Decodes base64 data',
    severity: 'low',
    detect: (t) => match(BASE64, t),
  },
  {
    id: 'decode_then_exec',
    title: 'Decodes data and runs it',
    severity: 'high',
    detect: (t) => (BASE64.test(t) && (EVAL.test(t) || COMPILE.test(t) || CHILD_PROCESS.test(t)) ? match(BASE64, t) : null),
  },
  {
    id: 'decrypt_then_exec',
    title: 'Decrypts a payload and runs it',
    severity: 'high',
    detect: (t) => (DECIPHER.test(t) && (EVAL.test(t) || COMPILE.test(t)) ? match(DECIPHER, t) : null),
  },
  {
    id: 'secret_file_read',
    title: 'References credential or secret files',
    severity: 'high',
    detect: (t) =>
      match(/\.ssh[/\\]|\bid_(?:rsa|ed25519|ecdsa)\b|\.npmrc\b|\.aws[/\\]credentials|\.git-credentials|\.netrc\b|\.kube[/\\]config|Login Data|wallet\.dat|\.docker[/\\]config\.json/, t) ??
      match(/['"`](?:[^'"`\n]{0,60}[/\\])?\.env(?:\.[a-z]{1,12})?['"`]/i, t),
  },
  {
    id: 'env_dump',
    title: 'Reads every environment variable',
    severity: 'medium',
    detect: (t) => match(/JSON\.stringify\(\s*process\.env\b|Object\.(?:entries|keys|values)\(\s*process\.env\s*\)/, t),
  },
  {
    id: 'suspicious_network_host',
    title: 'Contacts a raw IP, paste site, webhook or tunnel',
    severity: 'high',
    detect: (t, ctx) => {
      if (!NETWORK_API.test(t)) return null;
      const hit = newHosts(t, ctx).find((h) => IP_LITERAL.test(h) || EXFIL_HOSTS.test(h));
      return hit ? `new host ${hit}` : null;
    },
  },
  {
    id: 'new_network_host',
    title: 'Contacts a host the previous version did not',
    severity: 'low',
    detect: (t, ctx) => {
      if (!NETWORK_API.test(t)) return null;
      const hosts = newHosts(t, ctx).filter((h) => !IP_LITERAL.test(h) && !EXFIL_HOSTS.test(h) && !GEO_HOSTS.test(h));
      return hosts.length > 0 ? `new host(s) ${hosts.slice(0, 3).join(', ')}` : null;
    },
  },
  {
    id: 'geo_lookup',
    title: 'Looks up the machine\'s location by IP',
    severity: 'medium',
    detect: (t) => {
      const hit = [...hostsIn(t)].find((h) => GEO_HOSTS.test(h));
      return hit ? `calls ${hit}` : null;
    },
  },
  {
    id: 'geo_guarded_destruction',
    title: 'Location or locale check next to file writes or deletes',
    severity: 'critical',
    detect: (t) => (GEO_OR_LOCALE.test(t) && DESTRUCTIVE.test(t) ? match(GEO_OR_LOCALE, t) : null),
  },
  {
    id: 'date_guarded_destruction',
    title: 'Date check next to file writes or deletes',
    severity: 'high',
    detect: (t) => (DATE_GATE.test(t) && DESTRUCTIVE.test(t) && !GEO_OR_LOCALE.test(t) ? match(DATE_GATE, t) : null),
  },
  {
    id: 'writes_user_dirs',
    title: 'Writes files into the user\'s Desktop or home folders',
    severity: 'medium',
    detect: (t) =>
      /\b(?:Desktop|OneDrive)\b/.test(t) && /\bhomedir\b|USERPROFILE|process\.env\.HOME\b/.test(t) && WRITE_OP.test(t)
        ? match(/\b(?:Desktop|OneDrive)\b/, t)
        : null,
  },
  {
    id: 'persistence',
    title: 'Touches shell startup files, cron or system services',
    severity: 'high',
    detect: (t) =>
      match(/\.(?:bashrc|zshrc|bash_profile|zprofile)\b|\bcrontab\b|LaunchAgents|LaunchDaemons|CurrentVersion[/\\]Run|[/\\]Startup[/\\]|systemctl\s+(?:enable|--user)|\/etc\/(?:cron|init\.d|systemd)/i, t),
  },
  {
    id: 'obfuscated_identifiers',
    title: 'Machine-obfuscated code (_0x names)',
    severity: 'high',
    detect: (t) => (count(/\b_0x[0-9a-f]{4,6}\b/gi, t) >= 8 ? match(/\b_0x[0-9a-f]{4,6}\b/i, t) : null),
  },
  {
    id: 'encoded_blob',
    title: 'Very long base64 or hex string literal',
    severity: 'medium',
    detect: (t) => match(/['"`][A-Za-z0-9+/]{400,}={0,2}['"`]|['"`](?:[0-9a-fA-F]{2}){200,}['"`]/, t),
  },
  {
    id: 'escaped_string_blob',
    title: 'Long run of character codes or escape sequences',
    severity: 'medium',
    detect: (t) =>
      match(/String\.fromCharCode\s*\((?:\s*\d{1,5}\s*,){15,}|(?:\\x[0-9a-fA-F]{2}){24,}|(?:\\u[0-9a-fA-F]{4}){16,}/, t),
  },
];
