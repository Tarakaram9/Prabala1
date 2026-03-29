// ─────────────────────────────────────────────────────────────────────────────
// Prabala – Visual Regression Keywords
//
// Uses Playwright screenshot + pixel-by-pixel comparison (pure JS, no native
// deps). First run captures baseline; subsequent runs compare and fail on diff.
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordDefinition, PrabalaConfig } from '@prabala/core';
import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

function getPage(context: import('@prabala/core').ExecutionContext): Page {
  const session = context.driverInstances['web'] as any;
  if (!session?.page) throw new Error('No web session active. Use Web.Launch first.');
  return session.page;
}

/** Simple pixel difference using raw PNG bytes (no external deps). */
function pixelDiff(a: Buffer, b: Buffer): number {
  let diff = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  return diff / len;
}

export const visualKeywords: KeywordDefinition[] = [
  {
    name: 'Visual.AssertScreenshot',
    description: 'Take a screenshot and compare with the stored baseline. Fails if difference exceeds threshold.',
    params: ['name', 'threshold'],
    execute: async (params, context) => {
      const page = getPage(context);
      const cfg = (context.variables['__config__'] ?? {}) as PrabalaConfig;
      const baselineDir = cfg.visualBaselineDir
        ? path.resolve(cfg.visualBaselineDir)
        : path.join(cfg.outputDir ?? 'artifacts', 'visual-baselines');
      fs.mkdirSync(baselineDir, { recursive: true });

      const name = String(params['name'] ?? 'screenshot');
      const threshold = Number(params['threshold'] ?? 5); // max average diff per byte (0-255)
      const baselinePath = path.join(baselineDir, `${name}.png`);

      const current: Buffer = await page.screenshot({ fullPage: false }) as Buffer;

      if (!fs.existsSync(baselinePath)) {
        fs.writeFileSync(baselinePath, current);
        console.log(`[Visual] Baseline captured for "${name}" at ${baselinePath}`);
        return;
      }

      const baseline = fs.readFileSync(baselinePath);
      const diff = pixelDiff(current, baseline);

      // Save current screenshot for inspection
      const currentPath = path.join(cfg.outputDir ?? 'artifacts', `visual-diff-${name}.png`);
      fs.writeFileSync(currentPath, current);

      if (diff > threshold) {
        throw new Error(
          `Visual regression detected for "${name}". Average pixel diff: ${diff.toFixed(2)} (threshold: ${threshold}). ` +
          `Compare: ${currentPath} vs baseline: ${baselinePath}`
        );
      }
      console.log(`[Visual] "${name}" matches baseline (diff: ${diff.toFixed(2)})`);
    },
  },
  {
    name: 'Visual.UpdateBaseline',
    description: 'Capture and overwrite the baseline screenshot for a given name.',
    params: ['name'],
    execute: async (params, context) => {
      const page = getPage(context);
      const cfg = (context.variables['__config__'] ?? {}) as PrabalaConfig;
      const baselineDir = cfg.visualBaselineDir
        ? path.resolve(cfg.visualBaselineDir)
        : path.join(cfg.outputDir ?? 'artifacts', 'visual-baselines');
      fs.mkdirSync(baselineDir, { recursive: true });
      const name = String(params['name'] ?? 'screenshot');
      const buf: Buffer = await page.screenshot({ fullPage: false }) as Buffer;
      fs.writeFileSync(path.join(baselineDir, `${name}.png`), buf);
      console.log(`[Visual] Baseline updated for "${name}"`);
    },
  },
  {
    name: 'Visual.AssertElement',
    description: 'Take a screenshot of a specific element and compare with its stored baseline.',
    params: ['locator', 'name', 'threshold'],
    execute: async (params, context) => {
      const page = getPage(context);
      const cfg = (context.variables['__config__'] ?? {}) as PrabalaConfig;
      const baselineDir = cfg.visualBaselineDir
        ? path.resolve(cfg.visualBaselineDir)
        : path.join(cfg.outputDir ?? 'artifacts', 'visual-baselines');
      fs.mkdirSync(baselineDir, { recursive: true });

      const locator = String(params['locator'] ?? '');
      const name = String(params['name'] ?? 'element');
      const threshold = Number(params['threshold'] ?? 5);
      const baselinePath = path.join(baselineDir, `${name}.png`);

      const el = page.locator(locator).first();
      const current: Buffer = await el.screenshot() as Buffer;

      if (!fs.existsSync(baselinePath)) {
        fs.writeFileSync(baselinePath, current);
        console.log(`[Visual] Baseline captured for element "${name}"`);
        return;
      }

      const baseline = fs.readFileSync(baselinePath);
      const diff = pixelDiff(current, baseline);
      if (diff > threshold) {
        throw new Error(
          `Element visual regression for "${name}". Avg diff: ${diff.toFixed(2)} (threshold: ${threshold})`
        );
      }
      console.log(`[Visual] Element "${name}" matches baseline (diff: ${diff.toFixed(2)})`);
    },
  },
];
