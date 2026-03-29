// ─────────────────────────────────────────────────────────────────────────────
// @prabala/driver-web – Public API
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordRegistry, controlFlowKeywords } from '@prabala/core';
import { webKeywords } from './keywords/webKeywords';
import { visualKeywords } from './keywords/visualKeywords';
import { accessibilityKeywords } from './keywords/accessibilityKeywords';
import { mockKeywords } from './keywords/mockKeywords';
import { dbKeywords } from './keywords/dbKeywords';

// Auto-register all web keywords when this package is imported
export function registerWebKeywords(): void {
  KeywordRegistry.registerMany(webKeywords);
  KeywordRegistry.registerMany(visualKeywords);
  KeywordRegistry.registerMany(accessibilityKeywords);
  KeywordRegistry.registerMany(mockKeywords);
  KeywordRegistry.registerMany(dbKeywords);
  KeywordRegistry.registerMany(controlFlowKeywords);
}

export { WebDriverSession } from './WebDriverSession';
export { webKeywords } from './keywords/webKeywords';
export { visualKeywords } from './keywords/visualKeywords';
export { accessibilityKeywords } from './keywords/accessibilityKeywords';
export { mockKeywords } from './keywords/mockKeywords';
export { dbKeywords } from './keywords/dbKeywords';
