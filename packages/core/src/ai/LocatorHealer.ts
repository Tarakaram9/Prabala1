// ─────────────────────────────────────────────────────────────────────────────
// Prabala Core – LocatorHealer
//
// Two-tier self-healing strategy:
//   Tier 1 – Fallback chain: tries each ObjectEntry.fallbacks[] in order.
//            Free, zero-latency, pure Playwright.
//   Tier 2 – LLM repair: when ALL fallbacks fail, sends a trimmed HTML snapshot
//            to an LLM (Ollama / OpenAI / Anthropic) and asks it to suggest
//            a new locator. The winning locator is cached and optionally
//            written back to the object repository YAML.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import { ObjectEntry, LocatorStrategy, AiRepairConfig } from '../types';

// Maps our strategy enum → a Playwright locator expression string
export function strategyToExpression(strategy: LocatorStrategy, locator: string): string {
  switch (strategy) {
    case 'css':         return locator;
    case 'xpath':       return `xpath=${locator}`;
    case 'text':        return `text=${locator}`;
    case 'aria':        return `[aria-label="${locator}"]`;
    case 'id':          return `#${locator}`;
    case 'role':        return `role=${locator}`;
    case 'label':       return `label=${locator}`;
    case 'placeholder': return `[placeholder="${locator}"]`;
    case 'testId':      return `[data-testid="${locator}"]`;
    case 'automationId':return `[data-automation-id="${locator}"]`;
    case 'name':        return `[name="${locator}"]`;
    default:            return locator;
  }
}

// ── LLM provider adapters ────────────────────────────────────────────────────

async function callOllama(
  prompt: string,
  model: string,
  baseUrl: string,
): Promise<string> {
  const url = `${baseUrl}/api/generate`;
  const body = JSON.stringify({ model, prompt, stream: false });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { response: string };
  return json.response ?? '';
}

async function callOpenAI(
  prompt: string,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  // Azure OpenAI: endpoint contains .openai.azure.com
  // URL format: {baseUrl}/chat/completions?api-version=2024-02-01
  // Auth header: api-key instead of Authorization: Bearer
  const isAzure = baseUrl.includes('.openai.azure.com');
  const url = isAzure
    ? `${baseUrl}/chat/completions?api-version=2024-02-01`
    : `${baseUrl}/chat/completions`;
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 200,
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isAzure) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return json.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(
  prompt: string,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  const url = `${baseUrl}/messages`;
  const body = JSON.stringify({
    model,
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { content: Array<{ text: string }> };
  return json.content?.[0]?.text ?? '';
}

// ── Prompt builder ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert at finding UI element locators in HTML.
Given a snippet of HTML and a description of what element to find, return ONLY a
single CSS selector that uniquely identifies the element. No explanation, no markdown,
no quotes — just the raw CSS selector string.`;

function buildPrompt(description: string, htmlSnippet: string): string {
  return `${SYSTEM_PROMPT}

Element description: "${description}"

HTML snippet (trimmed to relevant section):
\`\`\`html
${htmlSnippet.slice(0, 6000)}
\`\`\`

CSS selector:`;
}

// Trim HTML to max ~6000 chars — keep elements near interactive tags
function trimHtml(html: string): string {
  // Remove script/style blocks
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ');
  return cleaned.slice(0, 6000);
}

// ── LLM dispatcher ────────────────────────────────────────────────────────────

async function askLlm(
  description: string,
  htmlSnippet: string,
  cfg: AiRepairConfig,
): Promise<string | null> {
  const prompt = buildPrompt(description, trimHtml(htmlSnippet));

  try {
    let raw: string;
    switch (cfg.provider) {
      case 'ollama':
        raw = await callOllama(
          prompt,
          cfg.model ?? 'llama3',
          cfg.baseUrl ?? 'http://localhost:11434',
        );
        break;
      case 'openai':
        raw = await callOpenAI(
          prompt,
          cfg.model ?? 'gpt-4o-mini',
          cfg.apiKey ?? '',
          cfg.baseUrl ?? 'https://api.openai.com/v1',
        );
        break;
      case 'anthropic':
        raw = await callAnthropic(
          prompt,
          cfg.model ?? 'claude-haiku-20240307',
          cfg.apiKey ?? '',
          cfg.baseUrl ?? 'https://api.anthropic.com/v1',
        );
        break;
      default:
        return null;
    }

    // Extract first non-empty line that looks like a CSS selector
    const line = raw.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('```'));
    return line ?? null;
  } catch (e) {
    console.warn(chalk.yellow(`  [LocatorHealer] LLM call failed: ${(e as Error).message}`));
    return null;
  }
}

// ── Repo write-back ───────────────────────────────────────────────────────────

export function writeBackToRepo(
  objectKey: string,
  newStrategy: LocatorStrategy,
  newLocator: string,
  objectRepositoryDir: string,
): void {
  if (!fs.existsSync(objectRepositoryDir)) return;
  const files = fs.readdirSync(objectRepositoryDir).filter((f) => f.match(/\.ya?ml$/));
  for (const file of files) {
    const filePath = path.join(objectRepositoryDir, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const repo = yaml.load(raw) as { objects: Record<string, ObjectEntry> };
    if (repo?.objects?.[objectKey]) {
      repo.objects[objectKey]._healedStrategy = newStrategy;
      repo.objects[objectKey]._healedLocator  = newLocator;
      fs.writeFileSync(filePath, yaml.dump(repo, { indent: 2 }), 'utf-8');
      console.log(chalk.gray(`  [LocatorHealer] Written healed locator back to ${file}`));
      return;
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface HealContext {
  /** Object key name (e.g. "loginButton") — used for logging + repo write-back */
  objectKey: string;
  /** The ObjectEntry from the repository */
  entry: ObjectEntry;
  /** AI repair config from PrabalaConfig (optional) */
  aiCfg?: AiRepairConfig;
  /** Async fn that returns true if the given expression resolves to a visible element */
  probe: (expression: string) => Promise<boolean>;
  /** Fn that returns the full page HTML — only called when LLM is needed */
  getHtml: () => Promise<string>;
  /** Object repository dir path — for write-back */
  objectRepositoryDir?: string;
  /**
   * Optional custom converter from ObjectEntry strategy+locator to an expression string.
   * Defaults to `strategyToExpression` (Playwright/web format).
   * Override for non-web drivers (e.g. desktop) that use a different locator syntax.
   */
  strategyToExpr?: (strategy: LocatorStrategy, locator: string) => string;
}

export interface HealResult {
  /** Final Playwright expression string to use */
  expression: string;
  /** Which tier healed the locator */
  healedBy: 'primary' | 'fallback' | 'llm' | null;
  /** The fallback entry that won, if tier=fallback */
  fallbackEntry?: { strategy: LocatorStrategy; locator: string };
}

/**
 * Core healing function. Returns the best expression string to use for this element.
 * Tries in order:
 *   1. Healed locator from previous run (cached in entry._healedLocator)
 *   2. Primary locator
 *   3. Fallbacks[]  (tier-1: free, instant)
 *   4. LLM repair   (tier-2: calls AI provider)
 */
export async function healLocator(ctx: HealContext): Promise<HealResult> {
  const { entry, objectKey, aiCfg, probe, getHtml, objectRepositoryDir } = ctx;
  const toExpr = ctx.strategyToExpr ?? strategyToExpression;

  // 0. Prefer a previously healed locator
  if (entry._healedStrategy && entry._healedLocator) {
    const expr = toExpr(entry._healedStrategy, entry._healedLocator);
    if (await probe(expr)) {
      return { expression: expr, healedBy: 'fallback' };
    }
  }

  // 1. Try primary locator
  const primaryExpr = toExpr(entry.strategy, entry.locator);
  if (await probe(primaryExpr)) {
    return { expression: primaryExpr, healedBy: 'primary' };
  }

  console.warn(chalk.yellow(
    `  [LocatorHealer] Primary locator failed for "${objectKey}" (${entry.strategy}: ${entry.locator})`
  ));

  // 2. Try fallbacks
  for (const fb of entry.fallbacks ?? []) {
    const expr = toExpr(fb.strategy as LocatorStrategy, fb.locator);
    const ok = await probe(expr);
    if (ok) {
      console.log(chalk.cyan(
        `  [LocatorHealer] Healed via fallback for "${objectKey}": ${fb.strategy}="${fb.locator}"`
      ));
      if (objectRepositoryDir) {
        writeBackToRepo(objectKey, fb.strategy as LocatorStrategy, fb.locator, objectRepositoryDir);
      }
      return {
        expression: expr,
        healedBy: 'fallback',
        fallbackEntry: { strategy: fb.strategy as LocatorStrategy, locator: fb.locator },
      };
    }
  }

  // 3. LLM repair
  if (aiCfg) {
    console.log(chalk.magenta(
      `  [LocatorHealer] All fallbacks exhausted — asking ${aiCfg.provider} to suggest locator for "${objectKey}"…`
    ));
    const html = await getHtml();
    const description = entry.description ?? objectKey;
    const llmLocator = await askLlm(description, html, aiCfg);

    if (llmLocator) {
      const ok = await probe(llmLocator);
      if (ok) {
        console.log(chalk.green(
          `  [LocatorHealer] LLM healed "${objectKey}" with: ${llmLocator}`
        ));
        if ((aiCfg.autoUpdateRepo ?? true) && objectRepositoryDir) {
          writeBackToRepo(objectKey, 'css', llmLocator, objectRepositoryDir);
        }
        return { expression: llmLocator, healedBy: 'llm' };
      }
      console.warn(chalk.yellow(
        `  [LocatorHealer] LLM suggestion "${llmLocator}" did not match any element`
      ));
    }
  }

  // 4. Give up — return primary so Playwright throws the real error
  return { expression: primaryExpr, healedBy: null };
}
