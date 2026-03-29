// ─────────────────────────────────────────────────────────────────────────────
// Prabala – Control Flow Keywords
// If.Condition, If.Else, If.End, Loop.ForEach, Loop.While, Loop.End, Break
//
// These are handled as first-class keywords in TestEngine for proper step
// skipping. The keyword definitions here are registrations only (execute is
// a no-op because the engine intercepts them before dispatch).
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordDefinition } from '../types';

export const controlFlowKeywords: KeywordDefinition[] = [
  {
    name: 'If.Condition',
    description: 'Begin a conditional block. Steps until If.Else or If.End run only when expression is truthy.',
    params: ['expression'],
    execute: async () => { /* handled by engine */ },
  },
  {
    name: 'If.Else',
    description: 'Flip the condition of the current If block.',
    params: [],
    execute: async () => { /* handled by engine */ },
  },
  {
    name: 'If.End',
    description: 'Close the most recent If block.',
    params: [],
    execute: async () => { /* handled by engine */ },
  },
  {
    name: 'Loop.ForEach',
    description: 'Repeat enclosed steps for each item in a comma-separated list.',
    params: ['items', 'variable'],
    execute: async (params, context) => {
      // Simple implementation: engine doesn't yet support full loop unrolling at
      // compile time, so this registers the variable for the current iteration.
      const items = String(params['items'] ?? '').split(',').map((s) => s.trim());
      const varName = String(params['variable'] ?? 'item');
      // Store iteration context for next-round resolution
      context.variables[varName] = items[0] ?? '';
    },
  },
  {
    name: 'Loop.End',
    description: 'Close the most recent Loop block.',
    params: [],
    execute: async () => { /* handled by engine */ },
  },
  {
    name: 'Break',
    description: 'Exit the current Loop immediately.',
    params: [],
    execute: async () => { /* handled by engine */ },
  },
  {
    name: 'Set.Variable',
    description: 'Set a named variable to a value for use in later steps.',
    params: ['name', 'value'],
    execute: async (params, context) => {
      context.variables[String(params['name'])] = params['value'];
    },
  },
  {
    name: 'Log.Message',
    description: 'Print a message to the test execution log.',
    params: ['message'],
    execute: async (params) => {
      console.log(`[Log] ${params['message']}`);
    },
  },
  {
    name: 'Assert.Variable',
    description: 'Assert that a variable equals an expected value.',
    params: ['name', 'expected'],
    execute: async (params, context) => {
      const actual = String(context.variables[String(params['name'])] ?? '');
      const expected = String(params['expected'] ?? '');
      if (actual !== expected) {
        throw new Error(`Variable "${params['name']}" = "${actual}" but expected "${expected}"`);
      }
    },
  },
  {
    name: 'Assert.Contains',
    description: 'Assert that a variable contains a substring.',
    params: ['name', 'substring'],
    execute: async (params, context) => {
      const actual = String(context.variables[String(params['name'])] ?? '');
      const sub = String(params['substring'] ?? '');
      if (!actual.includes(sub)) {
        throw new Error(`Variable "${params['name']}" = "${actual}" does not contain "${sub}"`);
      }
    },
  },
];
