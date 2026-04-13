// ─────────────────────────────────────────────────────────────────────────────
// Prabala Desktop Driver – Keyword Library (Appium-backed)
//
// Supported locator formats:
//   id=value            accessibility id (recommended, works everywhere)
//   automationId=value  alias for id=
//   name=value          element name attribute
//   xpath=//path        XPath expression
//   class=ClassName     class name
//   ~value              raw accessibility id shorthand
//   //xpath             raw XPath pass-through
//   plain string        treated as accessibility id
//
// Quick-start:
//   npm install -g appium
//   appium driver install mac2      # macOS
//   appium driver install windows   # Windows
//   appium                          # start server, then run your tests
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import * as fs from 'fs';
import { KeywordDefinition, ExecutionContext, ObjectEntry, PrabalaConfig, healLocator } from '@prabala/core';
import { DesktopSession } from './DesktopSession';


// ── Context helper ─────────────────────────────────────────────────────────
function getSession(context: ExecutionContext): DesktopSession {
  const session = context.driverInstances['desktop'] as DesktopSession | undefined;
  if (!session) throw new Error(
    'No desktop session active — use Desktop.LaunchApp first.'
  );
  return session;
}

// ── Desktop locator format: convert ObjectEntry strategy+value → "type=value" ─
function desktopStrategyToLocator(strategy: string, locator: string): string {
  switch (strategy) {
    case 'id':          return `id=${locator}`;
    case 'automationId':return `id=${locator}`;
    case 'name':        return `name=${locator}`;
    case 'role':        return `role=${locator}`;
    case 'xpath':       return `xpath=${locator}`;
    case 'css':         return locator;           // raw CSS — works in Electron/CDP mode
    case 'text':        return `name=${locator}`; // closest match on desktop
    case 'aria':        return `name=${locator}`; // aria-label → name match
    case 'label':       return `name=${locator}`;
    default:            return locator;            // raw passthrough
  }
}

// ── Resolve a locator ref with self-healing — returns desktop locator string ─
// Accepts: raw string OR ObjectEntry from the object repository.
// When an ObjectEntry has fallbacks[] or aiRepair is configured in PrabalaConfig,
// tries fallbacks and/or LLM repair before surfacing a failure.
async function resolveDesktopLocator(
  session: DesktopSession,
  locatorRef: unknown,
  context: ExecutionContext,
): Promise<string> {
  // Raw string — no healing, pass through directly
  if (typeof locatorRef === 'string') return locatorRef;

  const obj = locatorRef as ObjectEntry;
  const cfg = (context.variables['__config__'] ?? {}) as PrabalaConfig;

  // Fast path — no fallbacks and no AI repair configured
  if (!obj.fallbacks?.length && !obj._healedLocator && !cfg.aiRepair) {
    return desktopStrategyToLocator(obj.strategy, obj.locator);
  }

  // Find the object key by scanning the repository
  const objectKey =
    Object.entries(context.objectRepository).find(([, v]) => v === obj)?.[0] ?? 'element';

  const result = await healLocator({
    objectKey,
    entry: obj,
    aiCfg: cfg.aiRepair,
    strategyToExpr: desktopStrategyToLocator,
    probe: async (expr: string) => {
      try { return await session._isDisplayed(expr); } catch { return false; }
    },
    getHtml: async () => {
      try { return await session.getPageSource(); } catch { return ''; }
    },
    objectRepositoryDir: cfg.objectRepositoryDir,
  });

  return result.expression;
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyword Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const desktopKeywords: KeywordDefinition[] = [

  // ── App lifecycle ──────────────────────────────────────────────────────────

  {
    name: 'Desktop.LaunchApp',
    description: [
      'Launch a desktop application using native OS accessibility APIs (no Appium required).',
      'macOS: appPath can be a .app path (/Applications/MyApp.app) or bundle ID (com.example.app).',
      'Windows: appPath is the .exe path.',
      'platform: darwin|mac|win32|windows — auto-detected if omitted.',
    ].join(' '),
    params: ['appPath', 'platform'],
    execute: async (params, context) => {
      const session = new DesktopSession();
      await session.launch({
        appPath:   String(params.appPath),
        platform:  params.platform  ? String(params.platform)  : undefined,
        appiumUrl: params.appiumUrl ? String(params.appiumUrl) : undefined,
        cdpPort:   params.cdpPort   ? Number(params.cdpPort)   : undefined,
      });
      context.driverInstances['desktop'] = session;
      context.currentDriver = 'desktop';
      console.log(`[Desktop] App launched: ${params.appPath}`);
    },
  },

  {
    name: 'Desktop.CloseApp',
    description: 'Close the desktop application.',
    params: [],
    execute: async (_params, context) => {
      const session = context.driverInstances['desktop'] as DesktopSession | undefined;
      if (session) {
        await session.close();
        delete context.driverInstances['desktop'];
        console.log('[Desktop] App closed.');
      }
    },
  },

  // ── Mouse actions ──────────────────────────────────────────────────────────

  {
    name: 'Desktop.Click',
    description: 'Click a UI element.',
    params: ['locator'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      await el.waitForDisplayed({ timeout: session.defaultTimeout });
      await el.click();
    },
  },

  {
    name: 'Desktop.DoubleClick',
    description: 'Double-click a UI element.',
    params: ['locator'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      await el.waitForDisplayed({ timeout: session.defaultTimeout });
      await el.doubleClick();
    },
  },

  {
    name: 'Desktop.RightClick',
    description: 'Right-click a UI element to open its context menu.',
    params: ['locator'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      await el.waitForDisplayed({ timeout: session.defaultTimeout });
      await el.click({ button: 'right' });
    },
  },

  {
    name: 'Desktop.Hover',
    description: 'Move the mouse over a UI element without clicking.',
    params: ['locator'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      await el.moveTo();
    },
  },

  // ── Keyboard actions ───────────────────────────────────────────────────────

  {
    name: 'Desktop.EnterText',
    description: 'Click an input element and type text into it.',
    params: ['locator', 'value'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      await el.waitForDisplayed({ timeout: session.defaultTimeout });
      await el.click();
      await el.setValue(String(params.value));
    },
  },

  {
    name: 'Desktop.ClearText',
    description: 'Clear all text from an input field.',
    params: ['locator'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      await el.clearValue();
    },
  },

  {
    name: 'Desktop.PressKey',
    description: [
      'Press a keyboard key or shortcut.',
      'Simple: Enter, Tab, Escape, F5, ArrowDown, Delete.',
      'Combination: Control+a, Command+c, Shift+Tab, Control+Shift+Delete.',
    ].join(' '),
    params: ['key'],
    execute: async (params, context) => {
      await getSession(context).pressKey(String(params.key));
    },
  },

  // ── Wait ───────────────────────────────────────────────────────────────────

  {
    name: 'Desktop.WaitForVisible',
    description: 'Wait until a UI element becomes visible. Default timeout: 30s.',
    params: ['locator', 'timeout'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const timeout = params.timeout ? Number(params.timeout) : session.defaultTimeout;
      await el.waitForDisplayed({ timeout });
    },
  },

  {
    name: 'Desktop.WaitForHidden',
    description: 'Wait until a UI element is no longer visible. Default timeout: 30s.',
    params: ['locator', 'timeout'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const timeout = params.timeout ? Number(params.timeout) : session.defaultTimeout;
      await el.waitForDisplayed({ timeout, reverse: true });
    },
  },

  {
    name: 'Desktop.WaitForEnabled',
    description: 'Wait until a UI element becomes interactive/enabled.',
    params: ['locator', 'timeout'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const timeout = params.timeout ? Number(params.timeout) : session.defaultTimeout;
      await el.waitForEnabled({ timeout });
    },
  },

  // ── Assertions ─────────────────────────────────────────────────────────────

  {
    name: 'Desktop.AssertVisible',
    description: 'Assert a UI element is visible on screen.',
    params: ['locator'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const visible = await el.isDisplayed();
      if (!visible) throw new Error(`Desktop.AssertVisible FAILED — element not visible: ${params.locator}`);
    },
  },

  {
    name: 'Desktop.AssertNotVisible',
    description: 'Assert a UI element is not visible (may or may not exist in DOM).',
    params: ['locator'],
    execute: async (params, context) => {
      const session = getSession(context);
      const locator = await resolveDesktopLocator(session, params.locator, context);
      const el = await session.$(session.parseSelector(locator));
      const exists = await el.isExisting();
      if (exists) {
        const visible = await el.isDisplayed();
        if (visible) throw new Error(`Desktop.AssertNotVisible FAILED — element is visible: ${params.locator}`);
      }
    },
  },

  {
    name: 'Desktop.AssertText',
    description: 'Assert the text content of a UI element equals the expected value.',
    params: ['locator', 'expected'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const text = await el.getText();
      const expected = String(params.expected);
      if (text !== expected) throw new Error(
        `Desktop.AssertText FAILED — expected "${expected}" but got "${text}"`
      );
    },
  },

  {
    name: 'Desktop.AssertContainsText',
    description: 'Assert a UI element\'s text contains the expected substring.',
    params: ['locator', 'expected'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const text = await el.getText();
      const expected = String(params.expected);
      if (!text.includes(expected)) throw new Error(
        `Desktop.AssertContainsText FAILED — "${text}" does not contain "${expected}"`
      );
    },
  },

  {
    name: 'Desktop.AssertEnabled',
    description: 'Assert a UI element is enabled (interactable).',
    params: ['locator'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const enabled = await el.isEnabled();
      if (!enabled) throw new Error(`Desktop.AssertEnabled FAILED — element is disabled: ${params.locator}`);
    },
  },

  {
    name: 'Desktop.AssertDisabled',
    description: 'Assert a UI element is disabled.',
    params: ['locator'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const enabled = await el.isEnabled();
      if (enabled) throw new Error(`Desktop.AssertDisabled FAILED — element is enabled: ${params.locator}`);
    },
  },

  // ── Data capture ───────────────────────────────────────────────────────────

  {
    name: 'Desktop.GetText',
    description: 'Read the text of a UI element and store it in a variable.',
    params: ['locator', 'variable'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const text = await el.getText();
      context.variables[String(params.variable)] = text;
      console.log(`[Desktop] ${params.variable} = "${text}"`);
    },
  },

  {
    name: 'Desktop.GetAttribute',
    description: 'Read an attribute of a UI element and store it in a variable.',
    params: ['locator', 'attribute', 'variable'],
    execute: async (params, context) => {
      const session = getSession(context);
      const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
      const value = await el.getAttribute(String(params.attribute));
      context.variables[String(params.variable)] = value;
      console.log(`[Desktop] ${params.variable} = "${value}"`);
    },
  },

  // ── Scrolling ──────────────────────────────────────────────────────────────

  {
    name: 'Desktop.Scroll',
    description: [
      'Scroll within an element or the window.',
      'direction: up | down (default) | left | right.',
      'amount: pixels to scroll, default 300.',
      'locator: optional — scroll into view of the element if provided.',
    ].join(' '),
    params: ['locator', 'direction', 'amount'],
    execute: async (params, context) => {
      const driver = getSession(context).getDriver();
      const amount = Number(params.amount ?? 300);
      const dir = String(params.direction ?? 'down');
      const deltaX = dir === 'right' ? amount : dir === 'left' ? -amount : 0;
      const deltaY = dir === 'up' ? -amount : amount;

      if (params.locator) {
        const session = getSession(context);
        const el = await session.findElement(await resolveDesktopLocator(session, params.locator, context));
        await (el as any).scrollIntoView();
      }

      await driver.performActions([{
        type: 'wheel',
        id: 'wheel1',
        actions: [{ type: 'scroll', x: 0, y: 0, deltaX, deltaY, duration: 200 }],
      }]);
      await driver.releaseActions();
    },
  },

  // ── Window management ──────────────────────────────────────────────────────

  {
    name: 'Desktop.Maximize',
    description: 'Maximize the application window.',
    params: [],
    execute: async (_params, context) => {
      await getSession(context).getDriver().maximizeWindow();
    },
  },

  {
    name: 'Desktop.Minimize',
    description: 'Minimize the application window.',
    params: [],
    execute: async (_params, context) => {
      await getSession(context).getDriver().minimizeWindow();
    },
  },

  {
    name: 'Desktop.SetWindowSize',
    description: 'Resize the application window to specific dimensions.',
    params: ['width', 'height'],
    execute: async (params, context) => {
      await getSession(context).getDriver().setWindowSize(
        Number(params.width),
        Number(params.height)
      );
    },
  },

  // ── Screenshot ─────────────────────────────────────────────────────────────

  {
    name: 'Desktop.TakeScreenshot',
    description: 'Capture a screenshot of the application window and save it.',
    params: ['name'],
    execute: async (params, context) => {
      const driver = getSession(context).getDriver();
      const name = params.name ? String(params.name) : `desktop-screenshot-${Date.now()}`;
      const base64 = await driver.takeScreenshot();
      const outDir = context.artifacts.outputDir ?? 'artifacts';
      fs.mkdirSync(outDir, { recursive: true });
      const filePath = path.join(outDir, `${name}.png`);
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      context.artifacts.screenshots.push(filePath);
      console.log(`[Desktop] Screenshot saved: ${filePath}`);
    },
  },

];

// ── Exports ────────────────────────────────────────────────────────────────
export { DesktopSession };

export function registerDesktopKeywords(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { KeywordRegistry } = require('@prabala/core') as typeof import('@prabala/core');
  KeywordRegistry.registerMany(desktopKeywords);
}

