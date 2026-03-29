// ─────────────────────────────────────────────────────────────────────────────
// Prabala – API Mock / Stub Keywords
//
// Uses Playwright's network interception (page.route) to mock backend calls
// without any extra proxy infrastructure.
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordDefinition } from '@prabala/core';
import { Page, Route } from 'playwright';

function getPage(context: import('@prabala/core').ExecutionContext): Page {
  const session = context.driverInstances['web'] as any;
  if (!session?.page) throw new Error('No web session active. Use Web.Launch first.');
  return session.page;
}

/** Per-context interception registry — maps urlPattern to call count */
const interceptRegistry = new WeakMap<Page, Record<string, { count: number; handler: (r: Route) => Promise<void> }>>();

function getRegistry(page: Page): Record<string, { count: number; handler: (r: Route) => Promise<void> }> {
  if (!interceptRegistry.has(page)) interceptRegistry.set(page, {});
  return interceptRegistry.get(page)!;
}

export const mockKeywords: KeywordDefinition[] = [
  {
    name: 'Mock.Intercept',
    description: 'Intercept network requests matching a URL pattern and respond with custom data.',
    params: ['urlPattern', 'status', 'body', 'contentType'],
    execute: async (params, context) => {
      const page = getPage(context);
      const pattern = String(params['urlPattern'] ?? '**');
      const status = Number(params['status'] ?? 200);
      const body = String(params['body'] ?? '{}');
      const contentType = String(params['contentType'] ?? 'application/json');

      const registry = getRegistry(page);

      const handler = async (route: Route) => {
        registry[pattern].count++;
        await route.fulfill({ status, body, contentType });
      };

      registry[pattern] = { count: 0, handler };
      await page.route(pattern, handler);
      console.log(`[Mock] Intercepting "${pattern}" → HTTP ${status}`);
    },
  },
  {
    name: 'Mock.RespondWith',
    description: 'Update the response body of an already-registered mock intercept.',
    params: ['urlPattern', 'body', 'status'],
    execute: async (params, context) => {
      const page = getPage(context);
      const pattern = String(params['urlPattern'] ?? '**');
      const body = String(params['body'] ?? '{}');
      const status = Number(params['status'] ?? 200);

      // Remove old handler and register new one
      await page.unroute(pattern);
      const registry = getRegistry(page);
      const handler = async (route: Route) => {
        registry[pattern].count++;
        await route.fulfill({ status, body, contentType: 'application/json' });
      };
      registry[pattern] = { count: 0, handler };
      await page.route(pattern, handler);
      console.log(`[Mock] Updated intercept "${pattern}"`);
    },
  },
  {
    name: 'Mock.AssertCalled',
    description: 'Assert that a mocked URL was called at least once (or an exact count).',
    params: ['urlPattern', 'times'],
    execute: async (params, context) => {
      const page = getPage(context);
      const pattern = String(params['urlPattern'] ?? '**');
      const expectedTimes = params['times'] !== undefined ? Number(params['times']) : 1;

      const registry = getRegistry(page);
      const entry = registry[pattern];
      if (!entry) {
        throw new Error(`No mock registered for "${pattern}". Use Mock.Intercept first.`);
      }
      if (entry.count < expectedTimes) {
        throw new Error(
          `Mock "${pattern}" was called ${entry.count} time(s) but expected at least ${expectedTimes}.`
        );
      }
      console.log(`[Mock] "${pattern}" called ${entry.count} time(s) ✔`);
    },
  },
  {
    name: 'Mock.ClearAll',
    description: 'Remove all registered network intercepts.',
    params: [],
    execute: async (_params, context) => {
      const page = getPage(context);
      await page.unroute('**');
      interceptRegistry.delete(page);
      console.log('[Mock] All intercepts cleared');
    },
  },
];
