// ─────────────────────────────────────────────────────────────────────────────
// Prabala Web Driver – Playwright Session Manager
// ─────────────────────────────────────────────────────────────────────────────

import { Browser, BrowserContext, Page, chromium, firefox, webkit } from 'playwright';
import { PrabalaConfig } from '@prabala/core';

export class WebDriverSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private _page: Page | null = null;

  async launch(config: PrabalaConfig): Promise<void> {
    const browserType = config.browser ?? 'chromium';
    const launcher = browserType === 'firefox' ? firefox : browserType === 'webkit' ? webkit : chromium;

    this.browser = await launcher.launch({
      headless: config.headless ?? true,
      slowMo: 0,
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });

    if (config.outputDir) {
      await this.context.tracing.start({ screenshots: true, snapshots: true });
    }

    this._page = await this.context.newPage();
    this._page.setDefaultTimeout(config.timeout ?? 30000);
  }

  get page(): Page {
    if (!this._page) throw new Error('Web driver not launched. Call launch() first.');
    return this._page;
  }

  async saveTrace(outputPath: string): Promise<void> {
    if (this.context) {
      await this.context.tracing.stop({ path: outputPath });
    }
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this._page = null;
    this.context = null;
    this.browser = null;
  }
}
