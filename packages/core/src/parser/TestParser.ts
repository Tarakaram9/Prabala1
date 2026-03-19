// ─────────────────────────────────────────────────────────────────────────────
// Prabala Core – YAML Test Case Parser
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { TestCase, TestSuite, ObjectRepository, PrabalaConfig } from '../types';

export class TestParser {
  static parseTestCase(filePath: string): TestCase {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as TestCase;
    if (!parsed.testCase) {
      throw new Error(`Invalid test case file: ${filePath} — missing 'testCase' field`);
    }
    if (!Array.isArray(parsed.steps)) {
      throw new Error(`Invalid test case file: ${filePath} — missing 'steps' array`);
    }
    return parsed;
  }

  static parseTestSuite(filePath: string): TestSuite {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as TestSuite;
    if (!parsed.suite) {
      throw new Error(`Invalid suite file: ${filePath} — missing 'suite' field`);
    }
    return parsed;
  }

  static parseObjectRepository(filePath: string): ObjectRepository {
    const content = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(content) as ObjectRepository;
  }

  static parseConfig(filePath: string): PrabalaConfig {
    const content = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(content) as PrabalaConfig;
  }

  /**
   * Resolve variable placeholders.
   * Supports both {{TEST_DATA.key}} (recommended, Handlebars-style)
   * and legacy {TEST_DATA.key} (single-brace) syntax.
   * Resolution order: TEST_DATA → ENV → variables → process.env
   */
  static resolveVariables(
    value: string,
    variables: Record<string, unknown>,
    testData: Record<string, unknown>,
    env: Record<string, string> = {}
  ): string {
    // Match {{key}} first (double-brace), then {key} (single-brace)
    return value.replace(/\{\{([^}]+?)\}\}|\{([^{}]+)\}/g, (match, doubleKey, singleKey) => {
      const key = (doubleKey ?? singleKey).trim();
      if (key.startsWith('TEST_DATA.')) {
        const dataKey = key.slice('TEST_DATA.'.length);
        return String(testData[dataKey] ?? match);
      }
      if (key.startsWith('ENV.')) {
        const envKey = key.slice('ENV.'.length);
        return env[envKey] ?? process.env[envKey] ?? match;
      }
      return String(variables[key] ?? env[key] ?? process.env[key] ?? match);
    });
  }

  static loadTestData(filePath: string): Record<string, unknown> {
    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf-8');
    if (ext === '.json') return JSON.parse(content) as Record<string, unknown>;
    if (ext === '.yaml' || ext === '.yml') return yaml.load(content) as Record<string, unknown>;
    throw new Error(`Unsupported test data format: ${ext}`);
  }
}
