// ─────────────────────────────────────────────────────────────────────────────
// Prabala API Driver – REST Keyword Library (Axios-backed)
// ─────────────────────────────────────────────────────────────────────────────

import axios, { AxiosRequestConfig } from 'axios';
import { KeywordDefinition, ExecutionContext } from '@prabala/core';

/** Resolve a dot-notation path against an object, supporting array indices e.g. "items.0.id" */
function resolvePath(obj: unknown, path: string): unknown {
  return String(path).split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/** Build axios config with any session headers stored in context */
function buildConfig(context: ExecutionContext): AxiosRequestConfig {
  const headers = (context.variables['__headers__'] ?? {}) as Record<string, string>;
  return { headers };
}

/** Prepend __baseUrl__ to relative URLs */
function resolveUrl(url: string, context: ExecutionContext): string {
  const base = context.variables['__baseUrl__'] as string | undefined;
  if (base && !url.startsWith('http://') && !url.startsWith('https://')) {
    return base.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
  }
  return url;
}

export const apiKeywords: KeywordDefinition[] = [
  // ── Request keywords ────────────────────────────────────────────────────────
  {
    name: 'API.GET',
    description: 'Perform HTTP GET request and store the response',
    params: ['url', 'responseAs'],
    execute: async (params, context: ExecutionContext) => {
      const response = await axios.get(resolveUrl(String(params.url), context), buildConfig(context));
      context.variables['__lastStatus__'] = response.status;
      context.variables['__lastResponse__'] = response.data as unknown;
      context.variables['__lastHeaders__'] = response.headers as unknown;
      if (params.responseAs) {
        context.variables[String(params.responseAs)] = response.data as unknown;
      }
    },
  },
  {
    name: 'API.POST',
    description: 'Perform HTTP POST request and store the response',
    params: ['url', 'body', 'responseAs'],
    execute: async (params, context: ExecutionContext) => {
      const body =
        typeof params.body === 'string' ? JSON.parse(params.body) : params.body;
      const response = await axios.post(resolveUrl(String(params.url), context), body, buildConfig(context));
      context.variables['__lastStatus__'] = response.status;
      context.variables['__lastResponse__'] = response.data as unknown;
      context.variables['__lastHeaders__'] = response.headers as unknown;
      if (params.responseAs) {
        context.variables[String(params.responseAs)] = response.data as unknown;
      }
    },
  },
  {
    name: 'API.PUT',
    description: 'Perform HTTP PUT request and store the response',
    params: ['url', 'body', 'responseAs'],
    execute: async (params, context: ExecutionContext) => {
      const body =
        typeof params.body === 'string' ? JSON.parse(params.body) : params.body;
      const response = await axios.put(resolveUrl(String(params.url), context), body, buildConfig(context));
      context.variables['__lastStatus__'] = response.status;
      context.variables['__lastResponse__'] = response.data as unknown;
      context.variables['__lastHeaders__'] = response.headers as unknown;
      if (params.responseAs) {
        context.variables[String(params.responseAs)] = response.data as unknown;
      }
    },
  },
  {
    name: 'API.PATCH',
    description: 'Perform HTTP PATCH request and store the response',
    params: ['url', 'body', 'responseAs'],
    execute: async (params, context: ExecutionContext) => {
      const body =
        typeof params.body === 'string' ? JSON.parse(params.body) : params.body;
      const response = await axios.patch(resolveUrl(String(params.url), context), body, buildConfig(context));
      context.variables['__lastStatus__'] = response.status;
      context.variables['__lastResponse__'] = response.data as unknown;
      context.variables['__lastHeaders__'] = response.headers as unknown;
      if (params.responseAs) {
        context.variables[String(params.responseAs)] = response.data as unknown;
      }
    },
  },
  {
    name: 'API.DELETE',
    description: 'Perform HTTP DELETE request and store the response',
    params: ['url', 'responseAs'],
    execute: async (params, context: ExecutionContext) => {
      const response = await axios.delete(resolveUrl(String(params.url), context), buildConfig(context));
      context.variables['__lastStatus__'] = response.status;
      context.variables['__lastResponse__'] = response.data as unknown;
      context.variables['__lastHeaders__'] = response.headers as unknown;
      if (params.responseAs) {
        context.variables[String(params.responseAs)] = response.data as unknown;
      }
    },
  },
  // ── Session configuration ────────────────────────────────────────────────────
  {
    name: 'API.SetHeader',
    description: 'Set a request header that will be sent with all subsequent API calls',
    params: ['name', 'value'],
    execute: async (params, context: ExecutionContext) => {
      const headers = (context.variables['__headers__'] ?? {}) as Record<string, string>;
      headers[String(params.name)] = String(params.value);
      context.variables['__headers__'] = headers;
    },
  },
  {
    name: 'API.SetBaseUrl',
    description: 'Set a base URL prefix applied to all subsequent relative API request URLs',
    params: ['url'],
    execute: async (params, context: ExecutionContext) => {
      context.variables['__baseUrl__'] = String(params.url);
    },
  },
  // ── Assertion keywords ───────────────────────────────────────────────────────
  {
    name: 'API.AssertStatus',
    description: 'Assert the last HTTP response status code equals the expected value',
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
    description: 'Assert the value at a dot-notation path in the last response body equals expected',
    params: ['path', 'expected'],
    execute: async (params, context: ExecutionContext) => {
      const body = context.variables['__lastResponse__'];
      const val = resolvePath(body, String(params.path));
      if (String(val) !== String(params.expected)) {
        throw new Error(`Body assertion failed at "${params.path}". Expected: "${params.expected}", Got: "${val}"`);
      }
    },
  },
  {
    name: 'API.AssertBodyContains',
    description: 'Assert the value at a dot-notation path in the last response body contains a substring',
    params: ['path', 'expected'],
    execute: async (params, context: ExecutionContext) => {
      const body = context.variables['__lastResponse__'];
      const val = String(resolvePath(body, String(params.path)));
      if (!val.includes(String(params.expected))) {
        throw new Error(`Body contains-assertion failed at "${params.path}". Expected to contain: "${params.expected}", Got: "${val}"`);
      }
    },
  },
  {
    name: 'API.AssertBodyNotEmpty',
    description: 'Assert the response body (or value at an optional dot-notation path) is not empty/null',
    params: ['path'],
    execute: async (params, context: ExecutionContext) => {
      const body = context.variables['__lastResponse__'];
      const val = params.path ? resolvePath(body, String(params.path)) : body;
      if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) {
        throw new Error(`Body not-empty assertion failed${params.path ? ` at "${params.path}"` : ''}. Got: ${JSON.stringify(val)}`);
      }
    },
  },
  {
    name: 'API.AssertHeader',
    description: 'Assert the last HTTP response header equals the expected value',
    params: ['name', 'expected'],
    execute: async (params, context: ExecutionContext) => {
      const headers = (context.variables['__lastHeaders__'] ?? {}) as Record<string, string>;
      const actual = headers[String(params.name).toLowerCase()];
      if (!String(actual).includes(String(params.expected))) {
        throw new Error(`Header assertion failed for "${params.name}". Expected to contain: "${params.expected}", Got: "${actual}"`);
      }
    },
  },
];

export function registerApiKeywords(): void {
  const { KeywordRegistry } = require('@prabala/core') as typeof import('@prabala/core');
  KeywordRegistry.registerMany(apiKeywords);
}
