// ─────────────────────────────────────────────────────────────────────────────
// Prabala API Driver – REST Keyword Library (Axios-backed)
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios';
import { KeywordDefinition, ExecutionContext } from '@prabala/core';

export const apiKeywords: KeywordDefinition[] = [
  {
    name: 'API.GET',
    description: 'Perform HTTP GET request and store response',
    params: ['url', 'responseAs'],
    execute: async (params, context: ExecutionContext) => {
      const response = await axios.get(String(params.url));
      context.variables['__lastStatus__'] = response.status;
      context.variables['__lastResponse__'] = response.data as unknown;
      if (params.responseAs) {
        context.variables[String(params.responseAs)] = response.data as unknown;
      }
    },
  },
  {
    name: 'API.POST',
    description: 'Perform HTTP POST request',
    params: ['url', 'body', 'responseAs'],
    execute: async (params, context: ExecutionContext) => {
      const body =
        typeof params.body === 'string' ? JSON.parse(params.body) : params.body;
      const response = await axios.post(String(params.url), body);
      context.variables['__lastStatus__'] = response.status;
      context.variables['__lastResponse__'] = response.data as unknown;
      if (params.responseAs) {
        context.variables[String(params.responseAs)] = response.data as unknown;
      }
    },
  },
  {
    name: 'API.AssertStatus',
    description: 'Assert the last HTTP response status code',
    params: ['expected'],
    execute: async (params, context: ExecutionContext) => {
      const actual = context.variables['__lastStatus__'];
      if (actual !== Number(params.expected)) {
        throw new Error(`Status assertion failed. Expected: ${params.expected}, Got: ${actual}`);
      }
    },
  },
  {
    name: 'API.AssertBody',
    description: 'Assert the last HTTP response body contains a value',
    params: ['path', 'expected'],
    execute: async (params, context: ExecutionContext) => {
      const body = context.variables['__lastResponse__'] as Record<string, unknown>;
      const keys = String(params.path).split('.');
      let val: unknown = body;
      for (const k of keys) {
        val = (val as Record<string, unknown>)[k];
      }
      if (String(val) !== String(params.expected)) {
        throw new Error(`Body assertion failed at "${params.path}". Expected: "${params.expected}", Got: "${val}"`);
      }
    },
  },
];

export function registerApiKeywords(): void {
  const { KeywordRegistry } = require('@prabala/core') as typeof import('@prabala/core');
  KeywordRegistry.registerMany(apiKeywords);
}
