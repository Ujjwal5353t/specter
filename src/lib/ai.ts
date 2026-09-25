import type { AIExplanation } from '@/types';

/** Neither OPENROUTER_API_KEY nor GEMINI_API_KEY is set. */
export class AINotConfiguredError extends Error {
  constructor() {
    super('No AI API key configured. Set OPENROUTER_API_KEY or GEMINI_API_KEY in .env.local');
    this.name = 'AINotConfiguredError';
  }
}

/** Error text for a failed provider call: status plus a truncated body, with any API key scrubbed. */
async function failure(label: string, res: Response): Promise<string> {
  let body = await res.text().catch(() => '');
  for (const key of [process.env.OPENROUTER_API_KEY, process.env.GEMINI_API_KEY]) {
    if (key) body = body.split(key).join('[redacted]');
  }
  return `${label} ${res.status}: ${body.replace(/\s+/g, ' ').trim().slice(0, 300) || 'empty response'}`;
}

function errorText(label: string, e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  for (const key of [process.env.OPENROUTER_API_KEY, process.env.GEMINI_API_KEY]) {
    if (key) msg = msg.split(key).join('[redacted]');
  }
  msg = msg.slice(0, 400);
  return msg.startsWith(label) ? msg : `${label}: ${msg}`;
}

export async function explainFindings(
  findings: { scanner: string; title: string; detail: string; severity: string }[]
): Promise<AIExplanation> {
  // Brief the most severe tier present: critical/high if any, otherwise
  // medium — so a repo with only medium issues (e.g. a vulnerable package)
  // still gets a brief instead of a false "clean" verdict.
  const hasSevere = findings.some((f) => f.severity === 'critical' || f.severity === 'high');
  const briefed = new Set(hasSevere ? ['critical', 'high'] : ['medium']);

  // Group repeats of the same finding (e.g. many advisories for one
  // package@version) so they become one item rather than crowding out others.
  const groups = new Map<string, { scanner: string; title: string; severity: string; details: string[] }>();
  for (const f of findings) {
    if (!briefed.has(f.severity)) continue;
    const key = `${f.scanner}|${f.title}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { scanner: f.scanner, title: f.title, severity: f.severity, details: [f.detail] });
    else {
      if (f.severity === 'critical') g.severity = 'critical';
      if (!g.details.includes(f.detail)) g.details.push(f.detail);
    }
  }
  const top = [...groups.values()]
    .sort((a, b) => (b.severity === 'critical' ? 1 : 0) - (a.severity === 'critical' ? 1 : 0) || b.details.length - a.details.length)
    .slice(0, 6);

  if (top.length === 0) {
    return { summary: 'No critical, high or medium severity findings detected. Repository has a clean security posture.', items: [] };
  }

  const prompt = `You are a senior cybersecurity engineer reviewing automated security scan results.

Findings:
${top.map((f, i) => {
  const shown = f.details.slice(0, 8).map((d) => `   - ${d}`).join('\n');
  const more = f.details.length > 8 ? `\n   - …and ${f.details.length - 8} more` : '';
  return `${i + 1}. [${f.severity.toUpperCase()}] ${f.scanner.toUpperCase()}: ${f.title}\n${shown}${more}`;
}).join('\n\n')}

Respond ONLY with valid JSON (no markdown fences, no preamble):
{
  "summary": "2 sentences: overall risk level and most urgent action",
  "items": [
    {
      "title": "short finding name",
      "why_dangerous": "what an attacker can actually DO with this — be specific",
      "exact_fix": "exact commands or code to fix it right now",
      "attack_pattern": "how this class of vulnerability is typically exploited in practice, described as a general pattern"
    }
  ]
}

For "attack_pattern": describe the general technique attackers use against this class of issue. Do NOT name specific companies, breaches, incidents, or CVE IDs, and never invent events.`;

  // Try each configured provider in turn; a failing one (bad key, retired
  // model, rate limit) falls through to the next instead of yielding an
  // empty brief.
  const errors: string[] = [];

  // OpenRouter path
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
          'X-Title': 'Specter Security Scanner',
        },
        body: JSON.stringify({
          // 'openrouter/free' automatically selects from available free models at zero cost.
          model: process.env.OPENROUTER_MODEL ?? 'openrouter/free',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2000,
          temperature: 0.2,
        }),
      });
      if (!res.ok) throw new Error(await failure('OpenRouter', res));
      const data = await res.json().catch(() => ({}));
      const text: string = data.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error(`OpenRouter ${res.status}: empty response`);
      return parseAIResponse(text);
    } catch (e) {
      errors.push(errorText('OpenRouter', e));
    }
  }

  // Gemini direct path
  // Aliases track Google's current models, so they don't 404 when a pinned
  // version is retired; the lite model covers high-demand 503s on the main one.
  if (process.env.GEMINI_API_KEY) {
    const models = [process.env.GEMINI_MODEL ?? 'gemini-flash-latest', 'gemini-flash-lite-latest'];
    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              // Newer models spend part of this budget on thinking, so leave room for the JSON.
              generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
            }),
          }
        );
        if (!res.ok) throw new Error(await failure(`Gemini (${model})`, res));
        const data = await res.json().catch(() => ({}));
        const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (!text) throw new Error(`Gemini (${model}) ${res.status}: empty response`);
        return parseAIResponse(text);
      } catch (e) {
        errors.push(errorText(`Gemini (${model})`, e));
      }
    }
  }

  if (errors.length > 0) throw new Error(`AI providers failed: ${errors.join('; ')}`);
  throw new AINotConfiguredError();
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/** Extracts the JSON object from model output and coerces it to AIExplanation, dropping malformed items. */
function parseAIResponse(text: string): AIExplanation {
  try {
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const raw = JSON.parse(jsonMatch[0]);
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const items = (Array.isArray(raw.items) ? raw.items : [])
          .filter((it: unknown): it is Record<string, unknown> => !!it && typeof it === 'object' && !Array.isArray(it))
          .map((it: Record<string, unknown>) => ({
            title: str(it.title, 'Untitled finding'),
            why_dangerous: str(it.why_dangerous),
            exact_fix: str(it.exact_fix),
            attack_pattern: str(it.attack_pattern),
          }));
        const summary = str(raw.summary);
        if (summary || items.length > 0) return { summary, items };
      }
    }
  } catch {}
  return { summary: text.substring(0, 200), items: [] };
}
