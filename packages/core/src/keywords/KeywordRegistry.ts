// ─────────────────────────────────────────────────────────────────────────────
// Prabala Core – Keyword Registry
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordDefinition, ExecutionContext } from '../types';

export class KeywordRegistry {
  private static registry = new Map<string, KeywordDefinition>();

  static register(keyword: KeywordDefinition): void {
    this.registry.set(keyword.name.toLowerCase(), keyword);
  }

  static registerMany(keywords: KeywordDefinition[]): void {
    for (const kw of keywords) {
      this.register(kw);
    }
  }

  static resolve(name: string): KeywordDefinition | undefined {
    return this.registry.get(name.toLowerCase());
  }

  static listAll(): string[] {
    return Array.from(this.registry.keys());
  }

  static async execute(
    name: string,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<void> {
    const keyword = this.resolve(name);
    if (!keyword) {
      throw new Error(
        `Unknown keyword: "${name}". Available keywords: ${this.listAll().join(', ')}`
      );
    }
    await keyword.execute(params, context);
  }
}
