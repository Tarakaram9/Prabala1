// ─────────────────────────────────────────────────────────────────────────────
// Prabala – Accessibility Keywords
//
// Wraps @axe-core/playwright to run WCAG accessibility audits on the live page.
// If the package is not installed, keywords emit a clear install instruction.
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordDefinition } from '@prabala/core';
import { Page } from 'playwright';

function getPage(context: import('@prabala/core').ExecutionContext): Page {
  const session = context.driverInstances['web'] as any;
  if (!session?.page) throw new Error('No web session active. Use Web.Launch first.');
  return session.page;
}

async function runAxe(page: Page, options?: { include?: string; exclude?: string; tags?: string[] }) {
  let AxeBuilder: any;
  try {
    const mod = require('@axe-core/playwright');
    AxeBuilder = mod.default ?? mod.AxeBuilder;
  } catch {
    throw new Error(
      'axe-core is not installed. Run: npm install --save-dev @axe-core/playwright\n' +
      'Then re-run your tests.'
    );
  }

  let builder = new AxeBuilder({ page });
  if (options?.include) builder = builder.include(options.include);
  if (options?.exclude) builder = builder.exclude(options.exclude);
  if (options?.tags?.length) builder = builder.withTags(options.tags);

  return builder.analyze();
}

export const accessibilityKeywords: KeywordDefinition[] = [
  {
    name: 'Assert.NoAccessibilityViolations',
    description: 'Run an axe-core accessibility audit and fail if any violations are found.',
    params: ['include', 'exclude', 'tags'],
    execute: async (params, context) => {
      const page = getPage(context);
      const results = await runAxe(page, {
        include: params['include'] ? String(params['include']) : undefined,
        exclude: params['exclude'] ? String(params['exclude']) : undefined,
        tags: params['tags'] ? String(params['tags']).split(',').map((s) => s.trim()) : undefined,
      });

      if (results.violations.length > 0) {
        const summary = results.violations
          .map((v: any) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
          .join('\n  ');
        throw new Error(`Accessibility violations found:\n  ${summary}`);
      }
      console.log(`[A11y] No violations found (${results.passes.length} rules passed)`);
    },
  },
  {
    name: 'Assert.ColorContrast',
    description: 'Assert that no color-contrast violations exist on the current page.',
    params: [],
    execute: async (_params, context) => {
      const page = getPage(context);
      const results = await runAxe(page, { tags: ['wcag2aa'] });
      const contrastViolations = results.violations.filter((v: any) => v.id === 'color-contrast');
      if (contrastViolations.length > 0) {
        const nodes = contrastViolations[0].nodes.length;
        throw new Error(`Color contrast violations found on ${nodes} element(s).`);
      }
      console.log('[A11y] No color-contrast violations found');
    },
  },
  {
    name: 'Assert.AriaRole',
    description: 'Assert that a given CSS selector has the expected ARIA role attribute.',
    params: ['locator', 'role'],
    execute: async (params, context) => {
      const page = getPage(context);
      const locator = String(params['locator'] ?? '');
      const expectedRole = String(params['role'] ?? '');
      const el = page.locator(locator).first();
      const actualRole = await el.getAttribute('role');
      if (actualRole !== expectedRole) {
        throw new Error(`Element "${locator}" has role="${actualRole}" but expected "${expectedRole}"`);
      }
      console.log(`[A11y] Role check passed: "${locator}" has role="${expectedRole}"`);
    },
  },
];
