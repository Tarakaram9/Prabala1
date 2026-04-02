// ─────────────────────────────────────────────────────────────────────────────
// Prabala Web Driver – Web Keyword Library (Playwright-backed)
// ─────────────────────────────────────────────────────────────────────────────

import {
  KeywordDefinition, ExecutionContext, ObjectEntry, PrabalaConfig,
  healLocator, strategyToExpression,
} from '@prabala/core';
import { WebDriverSession } from '../WebDriverSession';
import { Page, Locator } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// ── Helper: get the active Playwright Page from context ─────────────────────
function getPage(context: ExecutionContext): Page {
  const session = context.driverInstances['web'] as WebDriverSession | undefined;
  if (!session) {
    throw new Error(
      'No web session active. Use the "Web.Launch" keyword to start a browser session.'
    );
  }
  return session.page;
}

// ── Helper: resolve a locator ref to a Playwright Locator with self-healing ─
// Accepts: raw string locator OR ObjectEntry from the object repository.
// When an ObjectEntry has fallbacks[] or aiRepair is configured in PrabalaConfig,
// it automatically tries fallbacks and/or LLM repair before surfacing an error.
async function resolveLocator(
  page: Page,
  locatorRef: unknown,
  context: ExecutionContext,
): Promise<Locator> {
  // Raw string — no healing, pure Playwright
  if (typeof locatorRef === 'string') {
    return page.locator(locatorRef);
  }

  const obj = locatorRef as ObjectEntry;
  const cfg = (context.variables['__config__'] ?? {}) as PrabalaConfig;

  // Fast path — no fallbacks and no AI repair configured
  if (!obj.fallbacks?.length && !obj._healedLocator && !cfg.aiRepair) {
    return page.locator(strategyToExpression(obj.strategy, obj.locator));
  }

  // Find the object key by scanning the repository (O(n) but trivially fast)
  const objectKey =
    Object.entries(context.objectRepository).find(([, v]) => v === obj)?.[0] ?? 'element';

  const result = await healLocator({
    objectKey,
    entry: obj,
    aiCfg: cfg.aiRepair,
    probe: async (expr: string) => {
      try { return (await page.locator(expr).count()) > 0; } catch { return false; }
    },
    getHtml: () => page.content(),
    objectRepositoryDir: cfg.objectRepositoryDir,
  });

  return page.locator(result.expression);
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyword Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const webKeywords: KeywordDefinition[] = [
  // ── Browser lifecycle ───────────────────────────────────────────────────────
  {
    name: 'Web.Launch',
    description: 'Launch a new browser session',
    params: [],
    execute: async (_params, context) => {
      const cfg = (context.variables['__config__'] ?? {}) as import('@prabala/core').PrabalaConfig;
      const session = new WebDriverSession();
      await session.launch(cfg);
      context.driverInstances['web'] = session;
      context.currentDriver = 'web';
    },
  },
  {
    name: 'Web.Close',
    description: 'Close the browser session',
    params: [],
    execute: async (_params, context) => {
      const session = context.driverInstances['web'] as WebDriverSession | undefined;
      if (session) {
        const cfg = context.variables['__config__'] as import('@prabala/core').PrabalaConfig;
        if (cfg?.outputDir) {
          const tracePath = path.join(cfg.outputDir, `trace-${Date.now()}.zip`);
          await session.saveTrace(tracePath);
          context.artifacts.traces.push(tracePath);
        }
        await session.close();
        delete context.driverInstances['web'];
      }
    },
  },

  // ── Navigation ──────────────────────────────────────────────────────────────
  {
    name: 'NavigateTo',
    description: 'Navigate to a URL',
    params: ['url'],
    execute: async (params, context) => {
      const page = getPage(context);
      await page.goto(String(params.url), { waitUntil: 'domcontentloaded' });
    },
  },
  {
    name: 'GoBack',
    description: 'Navigate browser back',
    params: [],
    execute: async (_params, context) => {
      await getPage(context).goBack();
    },
  },
  {
    name: 'Reload',
    description: 'Reload the current page',
    params: [],
    execute: async (_params, context) => {
      await getPage(context).reload();
    },
  },

  // ── Interaction ─────────────────────────────────────────────────────────────
  {
    name: 'Click',
    description: 'Click an element',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).click();
    },
  },
  {
    name: 'DoubleClick',
    description: 'Double-click an element',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).dblclick();
    },
  },
  {
    name: 'RightClick',
    description: 'Right-click an element',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).click({ button: 'right' });
    },
  },
  {
    name: 'EnterText',
    description: 'Type text into an input field',
    params: ['locator', 'value'],
    execute: async (params, context) => {
      const page = getPage(context);
      const loc = await resolveLocator(page, params.locator, context);
      await loc.clear();
      await loc.fill(String(params.value));
    },
  },
  {
    name: 'PressKey',
    description: 'Press a keyboard key (e.g. Enter, Tab, Escape)',
    params: ['key'],
    execute: async (params, context) => {
      await getPage(context).keyboard.press(String(params.key));
    },
  },
  {
    name: 'SelectOption',
    description: 'Select a dropdown option by label or value',
    params: ['locator', 'option'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).selectOption(String(params.option));
    },
  },
  {
    name: 'Hover',
    description: 'Hover over an element',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).hover();
    },
  },
  {
    name: 'ScrollTo',
    description: 'Scroll element into view',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).scrollIntoViewIfNeeded();
    },
  },
  {
    name: 'Check',
    description: 'Check a checkbox',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).check();
    },
  },
  {
    name: 'Uncheck',
    description: 'Uncheck a checkbox',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).uncheck();
    },
  },
  {
    name: 'UploadFile',
    description: 'Upload a file to a file input',
    params: ['locator', 'filePath'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).setInputFiles(String(params.filePath));
    },
  },

  // ── Waits ───────────────────────────────────────────────────────────────────
  {
    name: 'WaitForVisible',
    description: 'Wait until an element is visible. timeout=0 means no limit (default).',
    params: ['locator', 'timeout'],
    execute: async (params, context) => {
      const page = getPage(context);
      const timeoutMs = params.timeout !== undefined && params.timeout !== ''
        ? Number(params.timeout)
        : 0  // 0 = no timeout in Playwright waitFor
      await (await resolveLocator(page, params.locator, context)).waitFor({ state: 'visible', timeout: timeoutMs });
    },
  },
  {
    name: 'WaitForEnabled',
    description: 'Wait until an element is visible AND enabled (e.g. button no longer disabled). timeout=0 means no limit (default).',
    params: ['locator', 'timeout'],
    execute: async (params, context) => {
      const page = getPage(context);
      const timeoutMs = params.timeout !== undefined && params.timeout !== ''
        ? Number(params.timeout)
        : 0
      const loc = await resolveLocator(page, params.locator, context);
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      // Poll isEnabled() since waitFor() only checks visibility, not enabled state
      const deadline = timeoutMs === 0 ? Infinity : Date.now() + timeoutMs;
      while (true) {
        if (await loc.isEnabled()) break;
        if (Date.now() > deadline) throw new Error(`Element still disabled after ${timeoutMs}ms`);
        await page.waitForTimeout(200);
      }
    },
  },
  {
    name: 'WaitForHidden',
    description: 'Wait until an element is hidden',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await (await resolveLocator(page, params.locator, context)).waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'WaitForNavigation',
    description: 'Wait for page navigation to complete',
    params: [],
    execute: async (_params, context) => {
      await getPage(context).waitForLoadState('networkidle');
    },
  },
  {
    name: 'Wait',
    description: 'Wait for a fixed number of milliseconds',
    params: ['ms'],
    execute: async (params, context) => {
      await getPage(context).waitForTimeout(Number(params.ms ?? 1000));
    },
  },

  // ── Assertions ──────────────────────────────────────────────────────────────
  {
    name: 'AssertVisible',
    description: 'Assert that an element is visible',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      const loc = await resolveLocator(page, params.locator, context);
      const visible = await loc.isVisible();
      if (!visible) throw new Error(`Element is not visible: ${JSON.stringify(params.locator)}`);
    },
  },
  {
    name: 'AssertNotVisible',
    description: 'Assert that an element is NOT visible',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      const loc = await resolveLocator(page, params.locator, context);
      const visible = await loc.isVisible();
      if (visible) throw new Error(`Element should not be visible: ${JSON.stringify(params.locator)}`);
    },
  },
  {
    name: 'AssertText',
    description: 'Assert that an element contains expected text',
    params: ['locator', 'expected'],
    execute: async (params, context) => {
      const page = getPage(context);
      const actual = await (await resolveLocator(page, params.locator, context)).innerText();
      if (!actual.includes(String(params.expected))) {
        throw new Error(`Text assertion failed. Expected: "${params.expected}", Got: "${actual}"`);
      }
    },
  },
  {
    name: 'AssertTitle',
    description: 'Assert the page title contains expected text',
    params: ['expected'],
    execute: async (params, context) => {
      const title = await getPage(context).title();
      if (!title.includes(String(params.expected))) {
        throw new Error(`Title assertion failed. Expected: "${params.expected}", Got: "${title}"`);
      }
    },
  },
  {
    name: 'AssertUrl',
    description: 'Assert the current URL contains expected text',
    params: ['expected'],
    execute: async (params, context) => {
      const url = getPage(context).url();
      if (!url.includes(String(params.expected))) {
        throw new Error(`URL assertion failed. Expected to contain: "${params.expected}", Got: "${url}"`);
      }
    },
  },
  {
    name: 'AssertEnabled',
    description: 'Assert that an element is enabled',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      const enabled = await (await resolveLocator(page, params.locator, context)).isEnabled();
      if (!enabled) throw new Error(`Element is not enabled: ${JSON.stringify(params.locator)}`);
    },
  },
  {
    name: 'AssertValue',
    description: 'Assert the value of an input element',
    params: ['locator', 'expected'],
    execute: async (params, context) => {
      const page = getPage(context);
      const actual = await (await resolveLocator(page, params.locator, context)).inputValue();
      if (actual !== String(params.expected)) {
        throw new Error(`Value assertion failed. Expected: "${params.expected}", Got: "${actual}"`);
      }
    },
  },

  // ── Variables ───────────────────────────────────────────────────────────────
  {
    name: 'GetText',
    description: 'Capture element inner text into a variable',
    params: ['locator', 'variable'],
    execute: async (params, context) => {
      const page = getPage(context);
      const text = await (await resolveLocator(page, params.locator, context)).innerText();
      context.variables[String(params.variable)] = text;
    },
  },
  {
    name: 'GetValue',
    description: 'Capture input value into a variable',
    params: ['locator', 'variable'],
    execute: async (params, context) => {
      const page = getPage(context);
      const val = await (await resolveLocator(page, params.locator, context)).inputValue();
      context.variables[String(params.variable)] = val;
    },
  },

  // ── Screenshots ─────────────────────────────────────────────────────────────
  {
    name: 'TakeScreenshot',
    description: 'Take a screenshot and save to artifacts',
    params: ['name'],
    execute: async (params, context) => {
      const page = getPage(context);
      const name = String(params.name ?? `screenshot-${Date.now()}`);
      const screenshotPath = path.join(context.artifacts.outputDir, `${name}.png`);
      fs.mkdirSync(context.artifacts.outputDir, { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      context.artifacts.screenshots.push(screenshotPath);
    },
  },

  // ── Alerts ──────────────────────────────────────────────────────────────────
  {
    name: 'AcceptAlert',
    description: 'Accept a browser alert dialog',
    params: [],
    execute: async (_params, context) => {
      getPage(context).once('dialog', (dialog) => dialog.accept());
    },
  },
  {
    name: 'DismissAlert',
    description: 'Dismiss a browser alert dialog',
    params: [],
    execute: async (_params, context) => {
      getPage(context).once('dialog', (dialog) => dialog.dismiss());
    },
  },

  // ── Frames ──────────────────────────────────────────────────────────────────
  {
    name: 'SwitchToFrame',
    description: 'Switch context to an iframe by name or url',
    params: ['name'],
    execute: async (params, context) => {
      const page = getPage(context);
      const frame = page.frame({ name: String(params.name) });
      if (!frame) throw new Error(`Frame not found: ${params.name}`);
      context.driverInstances['activeFrame'] = frame;
    },
  },
];
