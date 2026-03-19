// ─────────────────────────────────────────────────────────────────────────────
// Prabala Desktop Driver – Stub (Phase 2)
// Supports: WinAppDriver (Windows), Appium Mac2 (macOS), AT-SPI (Linux)
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordDefinition, ExecutionContext } from '@prabala/core';

export const desktopKeywords: KeywordDefinition[] = [
  {
    name: 'Desktop.LaunchApp',
    description: 'Launch a desktop application',
    params: ['appPath', 'platform'],
    execute: async (params, _context: ExecutionContext) => {
      console.log(`[Desktop] Launching app: ${params.appPath} on ${params.platform ?? process.platform}`);
      // TODO (Phase 2): Integrate WinAppDriver / Appium Mac2 / AT-SPI
      throw new Error('Desktop.LaunchApp — Phase 2 feature. Coming soon!');
    },
  },
  {
    name: 'Desktop.Click',
    description: 'Click a desktop UI element by AutomationId, Name, or ClassName',
    params: ['locator'],
    execute: async (params, _context: ExecutionContext) => {
      console.log(`[Desktop] Click: ${params.locator}`);
      throw new Error('Desktop.Click — Phase 2 feature. Coming soon!');
    },
  },
  {
    name: 'Desktop.EnterText',
    description: 'Type text into a desktop input element',
    params: ['locator', 'value'],
    execute: async (params, _context: ExecutionContext) => {
      console.log(`[Desktop] EnterText: ${params.locator} = ${params.value}`);
      throw new Error('Desktop.EnterText — Phase 2 feature. Coming soon!');
    },
  },
  {
    name: 'Desktop.AssertVisible',
    description: 'Assert a desktop UI element is visible',
    params: ['locator'],
    execute: async (params, _context: ExecutionContext) => {
      console.log(`[Desktop] AssertVisible: ${params.locator}`);
      throw new Error('Desktop.AssertVisible — Phase 2 feature. Coming soon!');
    },
  },
  {
    name: 'Desktop.CloseApp',
    description: 'Close the desktop application',
    params: [],
    execute: async (_params, _context: ExecutionContext) => {
      throw new Error('Desktop.CloseApp — Phase 2 feature. Coming soon!');
    },
  },
];

export function registerDesktopKeywords(): void {
  const { KeywordRegistry } = require('@prabala/core') as typeof import('@prabala/core');
  KeywordRegistry.registerMany(desktopKeywords);
}
