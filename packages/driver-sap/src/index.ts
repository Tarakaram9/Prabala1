// ─────────────────────────────────────────────────────────────────────────────
// @prabala/driver-sap – SAP GUI Keyword Library
//
// Runtime requirements:
//   • Windows 10/11
//   • SAP GUI 7.40 or later (GUI for Windows)
//   • SAP Scripting enabled:
//       SAP Logon → Customise Local Layout (Alt+F12) → Scripting
//       Check: "Enable Scripting"  Uncheck: "Notify When a Script Attaches"
//   • Server-side scripting ON: transaction RZ11 → sapgui/user_scripting = TRUE
//   • winax installed: npm install -g winax
//
// Usage in YAML:
//   steps:
//     - keyword: SAP.Connect
//       params:
//         system: "S4H Dev"
//     - keyword: SAP.Login
//       params:
//         client: "100"
//         username: "{{TEST_DATA.user}}"
//         password: "{{TEST_DATA.pass}}"
//     - keyword: SAP.RunTCode
//       params:
//         tcode: "VA01"
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import { KeywordDefinition, ExecutionContext } from '@prabala/core';
import { SapSession } from './SapSession';

// ── Context helper ─────────────────────────────────────────────────────────
function getSession(ctx: ExecutionContext): SapSession {
  const s = ctx.driverInstances['sap'] as SapSession | undefined;
  if (!s) throw new Error('No active SAP session — use SAP.Connect first.');
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyword Definitions
// ─────────────────────────────────────────────────────────────────────────────
export const sapKeywords: KeywordDefinition[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // CONNECTION
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'SAP.Connect',
    description: [
      'Attach to an already-open SAP GUI session, or open a new connection.',
      'system: SAP Logon entry name (e.g. "ECC Dev" or "PRD"). Leave empty to use the first open session.',
      'sessionIndex: 0-based index within the connection (default 0).',
      'SAP GUI must be running and Scripting must be enabled in SAP GUI options.',
    ].join(' '),
    params: ['system', 'sessionIndex'],
    execute: async (params, ctx) => {
      const session = new SapSession();
      const system = params.system ? String(params.system) : '';
      const idx = params.sessionIndex ? parseInt(String(params.sessionIndex), 10) : 0;
      await session.connect(system, idx);
      ctx.driverInstances['sap'] = session;
      ctx.currentDriver = 'sap';
    },
  },

  {
    name: 'SAP.Disconnect',
    description: 'Close the SAP session gracefully and release the scripting connection.',
    params: [],
    execute: async (_p, ctx) => {
      const s = ctx.driverInstances['sap'] as SapSession | undefined;
      if (s) {
        s.disconnect();
        delete ctx.driverInstances['sap'];
      }
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'SAP.Login',
    description: [
      'Enter login credentials on the SAP logon screen and press Enter.',
      'client: SAP client/mandant number (e.g. "100").',
      'username: SAP user name.',
      'password: SAP password (use {{TEST_DATA.sapPass}} to keep it out of YAML).',
      'language: logon language code (default EN).',
    ].join(' '),
    params: ['client', 'username', 'password', 'language'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      if (params.client)   s.setText('wnd[0]/usr/txtRSYST-MANDT', String(params.client));
      if (params.username) s.setText('wnd[0]/usr/txtRSYST-UNAME', String(params.username));
      if (params.password) s.setText('wnd[0]/usr/pwdRSYST-BCODE', String(params.password));
      if (params.language) s.setText('wnd[0]/usr/txtRSYST-LANGU', String(params.language));
      s.sendVKey('Enter');
      console.log('[SAP] Logged in.');
    },
  },

  {
    name: 'SAP.Logout',
    description: 'Log off from SAP using the /nend command. Closes all open sessions.',
    params: [],
    execute: async (_p, ctx) => {
      const s = getSession(ctx);
      s.runTCode('/nend');
      console.log('[SAP] Logged out.');
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'SAP.RunTCode',
    description: [
      'Execute a SAP transaction code directly (equivalent to typing /n<tcode> in command field).',
      'tcode: transaction code, e.g. "VA01", "MM60", "SE38". Leading /n is optional.',
    ].join(' '),
    params: ['tcode'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const tc = String(params.tcode ?? '').trim();
      if (!tc) throw new Error('SAP.RunTCode: tcode parameter is required');
      s.runTCode(tc);
      console.log(`[SAP] TCode: ${tc}`);
    },
  },

  {
    name: 'SAP.PressKey',
    description: [
      'Press a virtual key or function key in the active SAP window.',
      'key: Enter | F1..F24 | Back | Save | Cancel | PageUp | PageDown | Find.',
      'window: optional window ID, default wnd[0].',
    ].join(' '),
    params: ['key', 'window'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const key = String(params.key ?? 'Enter');
      const wnd = params.window ? String(params.window) : 'wnd[0]';
      s.sendVKey(key, wnd);
      console.log(`[SAP] VKey: ${key}`);
    },
  },

  {
    name: 'SAP.SelectMenu',
    description: [
      'Select a menu item by its SAP GUI field ID.',
      'menuId: full SAP component ID of the menu item, e.g. "wnd[0]/mbar/menu[0]/menu[3]/menu[0]".',
      'Tip: Use SAP GUI Script Recording to capture the exact menu ID.',
    ].join(' '),
    params: ['menuId'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.menuId ?? '');
      if (!id) throw new Error('SAP.SelectMenu: menuId is required');
      s.selectMenu(id);
      console.log(`[SAP] Menu selected: ${id}`);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FIELD INTERACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'SAP.SetText',
    description: [
      'Set the value of a text input field identified by its SAP component ID.',
      'fieldId: SAP component path, e.g. "wnd[0]/usr/txtKUNAG-VBELN".',
      'value: the text to enter.',
    ].join(' '),
    params: ['fieldId', 'value'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.fieldId ?? '');
      const val = String(params.value ?? '');
      if (!id) throw new Error('SAP.SetText: fieldId is required');
      s.setText(id, val);
      console.log(`[SAP] SetText "${id}" = "${val}"`);
    },
  },

  {
    name: 'SAP.GetText',
    description: [
      'Read the value of a SAP field and store it in a context variable.',
      'fieldId: SAP component ID of the field.',
      'variable: name of the context variable to store the value in.',
    ].join(' '),
    params: ['fieldId', 'variable'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.fieldId ?? '');
      const varName = String(params.variable ?? 'SAP_VALUE');
      if (!id) throw new Error('SAP.GetText: fieldId is required');
      const text = s.getText(id);
      ctx.variables[varName] = text;
      console.log(`[SAP] GetText "${id}" → ${varName} = "${text}"`);
    },
  },

  {
    name: 'SAP.PressButton',
    description: [
      'Click a toolbar or dialog button by its SAP component ID.',
      'buttonId: SAP component path, e.g. "wnd[0]/tbar[1]/btn[8]" (Save), "wnd[0]/tbar[0]/btn[3]" (Back).',
      'Common toolbar btn numbers: btn[0]=?, btn[3]=Back, btn[8]=Save/Execute, btn[12]=Cancel.',
    ].join(' '),
    params: ['buttonId'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.buttonId ?? '');
      if (!id) throw new Error('SAP.PressButton: buttonId is required');
      s.pressButton(id);
      console.log(`[SAP] PressButton: ${id}`);
    },
  },

  {
    name: 'SAP.SelectComboBox',
    description: [
      'Select a value from a SAP combo box / dropdown (GuiComboBox) by its key.',
      'fieldId: SAP component ID of the combo box.',
      'key: the option key to select (NOT the display text — use SAP GUI scripting recorder to find it).',
    ].join(' '),
    params: ['fieldId', 'key'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.fieldId ?? '');
      const key = String(params.key ?? '');
      if (!id) throw new Error('SAP.SelectComboBox: fieldId is required');
      s.selectComboBox(id, key);
      console.log(`[SAP] ComboBox "${id}" → key "${key}"`);
    },
  },

  {
    name: 'SAP.SetCheckbox',
    description: [
      'Check or uncheck a SAP checkbox field.',
      'fieldId: SAP component ID of the checkbox.',
      'checked: true to check, false to uncheck.',
    ].join(' '),
    params: ['fieldId', 'checked'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.fieldId ?? '');
      const checked = String(params.checked).toLowerCase() !== 'false';
      if (!id) throw new Error('SAP.SetCheckbox: fieldId is required');
      s.setCheckbox(id, checked);
      console.log(`[SAP] Checkbox "${id}" = ${checked}`);
    },
  },

  {
    name: 'SAP.SelectTab',
    description: [
      'Select a tab page in a SAP tab strip control.',
      'tabId: SAP component ID of the tab page, e.g. "wnd[0]/usr/tabsTAB/tabpGEN".',
    ].join(' '),
    params: ['tabId'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.tabId ?? '');
      if (!id) throw new Error('SAP.SelectTab: tabId is required');
      s.selectTab(id);
      console.log(`[SAP] Tab selected: ${id}`);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE / GRID
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'SAP.GetTableCell',
    description: [
      'Read a cell value from a SAP table or ALV grid and store it in a variable.',
      'tableId: SAP component ID of the table control or grid.',
      'row: 0-based row index.',
      'column: column index (number) or column key (string for GuiGridView).',
      'variable: context variable name to store the value.',
    ].join(' '),
    params: ['tableId', 'row', 'column', 'variable'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.tableId ?? '');
      const row = parseInt(String(params.row ?? '0'), 10);
      const col = params.column !== undefined ? params.column as string | number : 0;
      const varName = String(params.variable ?? 'SAP_CELL');
      if (!id) throw new Error('SAP.GetTableCell: tableId is required');
      const value = s.getTableCellText(id, row, col);
      ctx.variables[varName] = value;
      console.log(`[SAP] TableCell[${row}][${col}] → ${varName} = "${value}"`);
    },
  },

  {
    name: 'SAP.DoubleClickTableRow',
    description: [
      'Double-click a row in a SAP Table control or ALV Grid to navigate into the detail screen.',
      'tableId: SAP component ID of the table/grid.',
      'row: 0-based row index to double-click.',
      'column: column to double-click (default 0).',
    ].join(' '),
    params: ['tableId', 'row', 'column'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.tableId ?? '');
      const row = parseInt(String(params.row ?? '0'), 10);
      const col = params.column !== undefined ? params.column as string | number : 0;
      if (!id) throw new Error('SAP.DoubleClickTableRow: tableId is required');
      s.doubleClickTableCell(id, row, col);
      console.log(`[SAP] DoubleClick table[${row}][${col}] in ${id}`);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ASSERTIONS
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'SAP.AssertText',
    description: [
      'Assert that a SAP field contains exactly the expected text value.',
      'fieldId: SAP component ID.',
      'expected: the exact text expected.',
    ].join(' '),
    params: ['fieldId', 'expected'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.fieldId ?? '');
      const expected = String(params.expected ?? '');
      if (!id) throw new Error('SAP.AssertText: fieldId is required');
      const actual = s.getText(id);
      if (actual !== expected) {
        throw new Error(
          `SAP.AssertText FAILED for "${id}":\n  Expected: "${expected}"\n  Actual  : "${actual}"`
        );
      }
      console.log(`[SAP] AssertText OK: "${id}" = "${expected}"`);
    },
  },

  {
    name: 'SAP.AssertContainsText',
    description: [
      'Assert that a SAP field value contains the expected substring.',
      'fieldId: SAP component ID.',
      'expected: substring to look for.',
    ].join(' '),
    params: ['fieldId', 'expected'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.fieldId ?? '');
      const expected = String(params.expected ?? '');
      if (!id) throw new Error('SAP.AssertContainsText: fieldId is required');
      const actual = s.getText(id);
      if (!actual.includes(expected)) {
        throw new Error(
          `SAP.AssertContainsText FAILED for "${id}":\n  Expected to contain: "${expected}"\n  Actual: "${actual}"`
        );
      }
      console.log(`[SAP] AssertContainsText OK: "${id}" contains "${expected}"`);
    },
  },

  {
    name: 'SAP.AssertExists',
    description: [
      'Assert that a SAP UI element with the given ID exists and is accessible.',
      'fieldId: SAP component path to check for existence.',
    ].join(' '),
    params: ['fieldId'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const id = String(params.fieldId ?? '');
      if (!id) throw new Error('SAP.AssertExists: fieldId is required');
      s.findById(id); // throws SapScriptingError if not found
      console.log(`[SAP] AssertExists OK: "${id}"`);
    },
  },

  {
    name: 'SAP.AssertStatusBar',
    description: [
      'Assert the SAP status bar (wnd[0]/sbar) message contains the expected text.',
      'expected: expected text in status bar (partial match).',
      'type: optional message type: S=Success, E=Error, W=Warning, I=Info, A=Abort.',
    ].join(' '),
    params: ['expected', 'type'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const expected = String(params.expected ?? '');
      const expectedType = params.type ? String(params.type).toUpperCase() : undefined;
      const actual = s.getStatusBarText();
      const actualType = s.getStatusBarType();
      if (expected && !actual.includes(expected)) {
        throw new Error(
          `SAP.AssertStatusBar FAILED:\n  Expected to contain: "${expected}"\n  Actual: "${actual}"`
        );
      }
      if (expectedType && actualType !== expectedType) {
        throw new Error(
          `SAP.AssertStatusBar type FAILED:\n  Expected type: "${expectedType}"\n  Actual type: "${actualType}"`
        );
      }
      console.log(`[SAP] AssertStatusBar OK: "${actual}" (type: ${actualType})`);
    },
  },

  {
    name: 'SAP.GetStatusBar',
    description: [
      'Read the current SAP status bar message and store it in a context variable.',
      'variable: variable name to store the message text (default: SAP_STATUS).',
    ].join(' '),
    params: ['variable'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const varName = String(params.variable ?? 'SAP_STATUS');
      const text = s.getStatusBarText();
      ctx.variables[varName] = text;
      console.log(`[SAP] StatusBar → ${varName} = "${text}"`);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'SAP.TakeScreenshot',
    description: [
      'Capture a screenshot of the current SAP GUI window.',
      'name: label for the screenshot file (spaces replaced with hyphens).',
    ].join(' '),
    params: ['name'],
    execute: async (params, ctx) => {
      const s = getSession(ctx);
      const name = String(params.name ?? 'sap-screenshot');
      const outDir = ctx.artifacts.outputDir ?? 'artifacts';
      const filePath = s.takeScreenshot(outDir, name);
      ctx.artifacts.screenshots.push(filePath);
    },
  },
];

// ── Registration helper ─────────────────────────────────────────────────────
import { KeywordRegistry } from '@prabala/core';

export function registerSapKeywords(): void {
  KeywordRegistry.registerMany(sapKeywords);
}

// Re-export session class for advanced users
export { SapSession } from './SapSession';
