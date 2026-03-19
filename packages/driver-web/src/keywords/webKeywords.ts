// ─────────────────────────────────────────────────────────────────────────────
// Prabala Web Driver – Web Keyword Library (Playwright-backed)
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordDefinition, ExecutionContext, ObjectEntry } from '@prabala/core';
import { WebDriverSession } from '../WebDriverSession';
import { Page } from 'playwright';
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

// ── Helper: resolve an ObjectEntry or raw locator string to a Playwright locator
function buildLocator(page: Page, locatorRef: unknown) {
  if (typeof locatorRef === 'string') {
    return page.locator(locatorRef);
  }
  const obj = locatorRef as ObjectEntry;
  switch (obj.strategy) {
    case 'css':
      return page.locator(obj.locator);
    case 'xpath':
      return page.locator(`xpath=${obj.locator}`);
    case 'text':
      return page.getByText(obj.locator);
    case 'aria':
      return page.locator(`[aria-label="${obj.locator}"]`);
    case 'id':
      return page.locator(`#${obj.locator}`);
    default:
      return page.locator(obj.locator);
  }
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
      await buildLocator(page, params.locator).click();
    },
  },
  {
    name: 'DoubleClick',
    description: 'Double-click an element',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await buildLocator(page, params.locator).dblclick();
    },
  },
  {
    name: 'RightClick',
    description: 'Right-click an element',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await buildLocator(page, params.locator).click({ button: 'right' });
    },
  },
  {
    name: 'EnterText',
    description: 'Type text into an input field',
    params: ['locator', 'value'],
    execute: async (params, context) => {
      const page = getPage(context);
      const loc = buildLocator(page, params.locator);
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
      await buildLocator(page, params.locator).selectOption(String(params.option));
    },
  },
  {
    name: 'Hover',
    description: 'Hover over an element',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await buildLocator(page, params.locator).hover();
    },
  },
  {
    name: 'ScrollTo',
    description: 'Scroll element into view',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await buildLocator(page, params.locator).scrollIntoViewIfNeeded();
    },
  },
  {
    name: 'Check',
    description: 'Check a checkbox',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await buildLocator(page, params.locator).check();
    },
  },
  {
    name: 'Uncheck',
    description: 'Uncheck a checkbox',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await buildLocator(page, params.locator).uncheck();
    },
  },
  {
    name: 'UploadFile',
    description: 'Upload a file to a file input',
    params: ['locator', 'filePath'],
    execute: async (params, context) => {
      const page = getPage(context);
      await buildLocator(page, params.locator).setInputFiles(String(params.filePath));
    },
  },

  // ── Waits ───────────────────────────────────────────────────────────────────
  {
    name: 'WaitForVisible',
    description: 'Wait until an element is visible',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await buildLocator(page, params.locator).waitFor({ state: 'visible' });
    },
  },
  {
    name: 'WaitForHidden',
    description: 'Wait until an element is hidden',
    params: ['locator'],
    execute: async (params, context) => {
      const page = getPage(context);
      await buildLocator(page, params.locator).waitFor({ state: 'hidden' });
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
      const loc = buildLocator(page, params.locator);
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
      const loc = buildLocator(page, params.locator);
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
      const actual = await buildLocator(page, params.locator).innerText();
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
      const enabled = await buildLocator(page, params.locator).isEnabled();
      if (!enabled) throw new Error(`Element is not enabled: ${JSON.stringify(params.locator)}`);
    },
  },
  {
    name: 'AssertValue',
    description: 'Assert the value of an input element',
    params: ['locator', 'expected'],
    execute: async (params, context) => {
      const page = getPage(context);
      const actual = await buildLocator(page, params.locator).inputValue();
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
      const text = await buildLocator(page, params.locator).innerText();
      context.variables[String(params.variable)] = text;
    },
  },
  {
    name: 'GetValue',
    description: 'Capture input value into a variable',
    params: ['locator', 'variable'],
    execute: async (params, context) => {
      const page = getPage(context);
      const val = await buildLocator(page, params.locator).inputValue();
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
