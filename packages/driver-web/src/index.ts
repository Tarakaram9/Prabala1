// ─────────────────────────────────────────────────────────────────────────────
// @prabala/driver-web – Public API
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordRegistry } from '@prabala/core';
import { webKeywords } from './keywords/webKeywords';

// Auto-register all web keywords when this package is imported
export function registerWebKeywords(): void {
  KeywordRegistry.registerMany(webKeywords);
}

export { WebDriverSession } from './WebDriverSession';
export { webKeywords } from './keywords/webKeywords';
