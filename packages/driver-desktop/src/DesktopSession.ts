// ─────────────────────────────────────────────────────────────────────────────
// Prabala Desktop Driver – Appium Session Manager
// Connects to a running Appium server and drives native desktop apps via the
// W3C WebDriver protocol.
//
// Supported back-ends (handled by Appium on the server side):
//   macOS   → mac2 driver        (install: appium driver install mac2)
//   Windows → windows driver     (install: appium driver install windows)
//   Linux   → linux driver       (install: appium driver install linux)
//
// One-time setup:
//   npm install -g appium
//   appium driver install mac2       # on macOS
//   appium driver install windows    # on Windows
//   appium &                         # start the server before running tests
// ─────────────────────────────────────────────────────────────────────────────

import { remote } from 'webdriverio';

// Use inferred type so we stay compatible regardless of webdriverio generic params
type WdioDriver = Awaited<ReturnType<typeof remote>>;

// W3C Unicode key codepoints for special keys
export const W3C_KEYS: Record<string, string> = {
  // Modifiers
  'Control': '\uE009', 'Ctrl': '\uE009',
  'Shift':   '\uE008',
  'Alt':     '\uE00A',
  'Meta':    '\uE03D', 'Command': '\uE03D', 'Cmd': '\uE03D', 'Win': '\uE03D',
  // Navigation
  'Enter':      '\uE007', 'Return':    '\uE007',
  'Tab':        '\uE004',
  'Escape':     '\uE00C', 'Esc':       '\uE00C',
  'Backspace':  '\uE003',
  'Delete':     '\uE017', 'Del':       '\uE017',
  'Space':      ' ',
  'ArrowUp':    '\uE013', 'Up':        '\uE013',
  'ArrowDown':  '\uE015', 'Down':      '\uE015',
  'ArrowLeft':  '\uE012', 'Left':      '\uE012',
  'ArrowRight': '\uE014', 'Right':     '\uE014',
  'Home':       '\uE011',
  'End':        '\uE010',
  'PageUp':     '\uE00E',
  'PageDown':   '\uE00F',
  // Function keys
  'F1':  '\uE031', 'F2':  '\uE032', 'F3':  '\uE033', 'F4':  '\uE034',
  'F5':  '\uE035', 'F6':  '\uE036', 'F7':  '\uE037', 'F8':  '\uE038',
  'F9':  '\uE039', 'F10': '\uE03A', 'F11': '\uE03B', 'F12': '\uE03C',
};

export interface DesktopLaunchOptions {
  /** App path (exe on Windows, .app path or bundle ID on macOS) */
  appPath: string;
  /** 'darwin' | 'mac' | 'win32' | 'windows' | 'linux' — auto-detected if omitted */
  platform?: string;
  /** Appium server URL, default http://localhost:4723 */
  appiumUrl?: string;
  /** Default element wait timeout in ms, default 30000 */
  timeout?: number;
}

export class DesktopSession {
  public driver: WdioDriver | null = null;
  public defaultTimeout = 30_000;

  // ── Launch ────────────────────────────────────────────────────────────────
  async launch(opts: DesktopLaunchOptions): Promise<void> {
    this.defaultTimeout = opts.timeout ?? 30_000;
    const rawPlat = (opts.platform ?? process.platform).toLowerCase();
    const platform = rawPlat.replace('darwin', 'mac').replace('macos', 'mac').replace('win32', 'windows');
    const appiumUrl = opts.appiumUrl ?? 'http://localhost:4723';
    const url = new URL(appiumUrl);

    let capabilities: Record<string, unknown>;

    if (platform === 'mac') {
      // macOS – Appium mac2 driver uses NSAccessibility API
      // appPath can be a bundle ID (com.apple.calculator) or .app path (/Applications/Calculator.app)
      const isBundleId = !opts.appPath.includes('/') && !opts.appPath.includes('\\');
      capabilities = {
        platformName: 'mac',
        'appium:automationName': 'mac2',
        ...(isBundleId
          ? { 'appium:bundleId': opts.appPath }
          : { 'appium:app': opts.appPath }),
        'appium:newCommandTimeout': Math.ceil(this.defaultTimeout / 1000),
      };
    } else if (platform === 'windows') {
      // Windows – Appium windows driver uses UIAutomation framework
      capabilities = {
        platformName: 'Windows',
        'appium:automationName': 'Windows',
        'appium:app': opts.appPath,
        'appium:newCommandTimeout': Math.ceil(this.defaultTimeout / 1000),
      };
    } else {
      // Linux – Appium linux driver (limited AT-SPI support)
      capabilities = {
        platformName: 'linux',
        'appium:automationName': 'linux',
        'appium:app': opts.appPath,
      };
    }

    this.driver = await remote({
      hostname: url.hostname,
      port: parseInt(url.port || '4723'),
      path: url.pathname === '/' ? '/wd/hub' : url.pathname,
      capabilities: capabilities as any,
      logLevel: 'error',
    });
  }

  // ── Locator parsing ───────────────────────────────────────────────────────
  /**
   * Convert a Prabala desktop locator string to a WebdriverIO selector.
   *
   * Supported formats:
   *   id=value           → ~value      (accessibility id — works on all platforms)
   *   automationId=value → ~value      (alias for id=)
   *   name=value         → ~value      (falls back to accessibility id)
   *   xpath=//path       → //path      (full XPath expression)
   *   class=ClassName    → ClassName   (class name selector)
   *   ~value             → ~value      (raw accessibility id shorthand)
   *   //xpath            → //xpath     (raw xpath pass-through)
   *   plain string       → ~plain      (treated as accessibility id)
   */
  parseSelector(locator: string): string {
    if (locator.startsWith('id='))          return `~${locator.slice(3)}`;
    if (locator.startsWith('automationId='))return `~${locator.slice(13)}`;
    if (locator.startsWith('name='))        return `~${locator.slice(5)}`;
    if (locator.startsWith('xpath='))       return locator.slice(6);
    if (locator.startsWith('class='))       return locator.slice(6);
    if (locator.startsWith('~'))            return locator;
    if (locator.startsWith('//') || locator.startsWith('(//')) return locator;
    return `~${locator}`; // default: accessibility id
  }

  // ── Element helpers ───────────────────────────────────────────────────────
  getDriver(): WdioDriver {
    if (!this.driver) throw new Error(
      'No desktop session active — use Desktop.LaunchApp first.'
    );
    return this.driver;
  }

  async findElement(locator: string) {
    const sel = this.parseSelector(locator);
    return this.getDriver().$(sel);
  }

  // ── Key helpers ───────────────────────────────────────────────────────────
  /**
   * Press a key or keyboard shortcut.
   * Simple key: "Enter", "Tab", "F5"
   * Combination: "Control+a", "Command+c", "Shift+Tab"
   */
  async pressKey(key: string): Promise<void> {
    const driver = this.getDriver();
    const parts = key.split('+').map(k => k.trim());

    if (parts.length === 1) {
      const k = W3C_KEYS[parts[0]] ?? parts[0];
      await driver.keys([k]);
    } else {
      // Multi-key combination: use W3C Actions to hold modifier(s) during key press
      const actions = [];
      const modifiers = parts.slice(0, -1).map(m => W3C_KEYS[m] ?? m);
      const mainKey = W3C_KEYS[parts[parts.length - 1]] ?? parts[parts.length - 1];

      // Key downs
      for (const mod of modifiers) actions.push({ type: 'keyDown', value: mod });
      actions.push({ type: 'keyDown', value: mainKey });
      // Key ups (reverse order)
      actions.push({ type: 'keyUp', value: mainKey });
      for (const mod of [...modifiers].reverse()) actions.push({ type: 'keyUp', value: mod });

      await driver.performActions([{ type: 'key', id: 'kb', actions }]);
      await driver.releaseActions();
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.deleteSession().catch(() => {});
      this.driver = null;
    }
  }
}
