// ─────────────────────────────────────────────────────────────────────────────
// Prabala SAP Driver – SapSession
//
// Wraps the SAP GUI Scripting COM API via the `winax` optional package.
// Prerequisites (Windows only):
//   1. SAP GUI 7.x or later installed
//   2. SAP GUI Scripting enabled in SAP Logon → Options → Accessibility & Scripting
//   3. Server-side SAPGUI/WS scripting parameter RZ11: sapgui/user_scripting = TRUE
//   4.  npm install -g winax   (native addon, builds against current Node.js)
//
// SAP GUI Scripting Object Model:
//   Application (SAPROTWrapper / ScriptingEngine)
//     └── Connection (GuiConnection)   — one per system
//           └── Session (GuiSession / GuiMainWindow)
//                 └── wnd[0]  / usr / prefix/field-id
//
// Field ID examples:
//   wnd[0]                          – main window
//   wnd[0]/usr/txtRSYST-UNAME       – username field on login screen
//   wnd[0]/usr/pwdRSYST-BCODE       – password field
//   wnd[0]/tbar[0]/okcd             – TCode entry box (command field)
//   wnd[0]/tbar[1]/btn[8]           – Save button (F8)
//   wnd[0]/usr/tabsXXX/tabpYYY      – tab page
//   wnd[0]/usr/cntlGRID/shellcont/shell – SAP Grid
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';

// ── SAP Virtual Key mapping ────────────────────────────────────────────────
// sendVKey(n) maps:  0=Enter  3=F3(Back)  8=F8(Save/Execute)  12=F12(Cancel)
export const SAP_VKEYS: Record<string, number> = {
  'Enter':  0,
  'F1':  1,  'F2':  2,  'F3':  3,  'F4':  4,
  'F5':  5,  'F6':  6,  'F7':  7,  'F8':  8,
  'F9':  9,  'F10': 10, 'F11': 11, 'F12': 12,
  // Shift+F keys = F13..F24
  'F13': 13, 'F14': 14, 'F15': 15, 'F16': 16,
  'F17': 17, 'F18': 18, 'F19': 19, 'F20': 20,
  'F21': 21, 'F22': 22, 'F23': 23, 'F24': 24,
  // Common named aliases
  'Back':   3,
  'Save':   8,
  'Cancel': 12,
  'PageUp': 7,
  'PageDown': 6,
  'Find':   16,
};

// ── Error types ────────────────────────────────────────────────────────────
export class SapScriptingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SapScriptingError';
  }
}

// ── SapSession ──────────────────────────────────────────────────────────────
export class SapSession {
  // The live GuiSession COM object
  private _session: any = null;
  // The Application-level scripting engine
  private _engine: any = null;

  // ── Platform / winax bootstrap ──────────────────────────────────────────
  private requireWinax(): any {
    if (process.platform !== 'win32') {
      throw new SapScriptingError(
        'SAP GUI automation is only supported on Windows. ' +
        'SAP GUI for Windows must be installed with Scripting enabled.'
      );
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('winax');
    } catch {
      throw new SapScriptingError(
        'winax package not found.\n' +
        'Install it with: npm install -g winax\n' +
        '(Requires Visual C++ Build Tools on Windows)'
      );
    }
  }

  // ── Connect ────────────────────────────────────────────────────────────
  /**
   * Attach to a running SAP GUI session (connection already open in SAP Logon),
   * or open a new connection by system ID / description.
   *
   * @param systemId  SAP Logon entry name (e.g. "ECC Dev") or connection string.
   *                  Pass '' or omit to attach to the first existing session.
   * @param sessionIndex  0-based session index within the connection (default: 0)
   */
  async connect(systemId = '', sessionIndex = 0): Promise<void> {
    const winax = this.requireWinax();

    // Attach via SAP ROT (Running Object Table)
    let rotWrapper: any;
    try {
      rotWrapper = new winax.Object('SapROTWrapper');
    } catch {
      throw new SapScriptingError(
        'SAP GUI is not running. Please open SAP Logon and establish a connection first.'
      );
    }

    const utils = rotWrapper.GetROTEntry('SAPGUI');
    if (!utils) {
      throw new SapScriptingError(
        'SAPGUI not found in ROT. Ensure SAP GUI is open and "Scripting" is enabled in SAP GUI options.'
      );
    }

    this._engine = utils.GetScriptingEngine();

    // Find or open connection
    let connection: any;
    if (systemId) {
      // Try to find existing open connection first
      for (let i = 0; i < this._engine.Children.Count; i++) {
        const c = this._engine.Children.Item(i);
        if (String(c.Description).toLowerCase().includes(systemId.toLowerCase()) ||
            String(c.SystemName).toLowerCase().includes(systemId.toLowerCase())) {
          connection = c;
          break;
        }
      }
      // Open new connection if not already open
      if (!connection) {
        connection = this._engine.OpenConnectionByConnectionString(systemId, true);
        if (!connection) {
          connection = this._engine.OpenConnection(systemId, true);
        }
      }
    } else {
      // Use first available connection
      if (this._engine.Children.Count === 0) {
        throw new SapScriptingError(
          'No open SAP connections found. ' +
          'Open SAP Logon and connect to a system first, or provide a systemId to SAP.Connect.'
        );
      }
      connection = this._engine.Children.Item(0);
    }

    // Get session
    if (connection.Children.Count <= sessionIndex) {
      throw new SapScriptingError(
        `Session index ${sessionIndex} not found. ` +
        `The connection has ${connection.Children.Count} session(s).`
      );
    }
    this._session = connection.Children.Item(sessionIndex);
    console.log(
      `[SAP] Connected — System: ${this._session.Info.SystemName}, ` +
      `Client: ${this._session.Info.Client}, ` +
      `User: ${this._session.Info.User}`
    );
  }

  // ── Guard ──────────────────────────────────────────────────────────────
  getSession(): any {
    if (!this._session) {
      throw new SapScriptingError('No active SAP session — use SAP.Connect first.');
    }
    return this._session;
  }

  // ── Field access ───────────────────────────────────────────────────────
  /**
   * Find a GuiComponent by its full path ID (e.g. wnd[0]/usr/txtRSYST-UNAME).
   * Throws SapScriptingError if not found.
   */
  findById(fieldId: string): any {
    const session = this.getSession();
    try {
      const el = session.findById(fieldId);
      if (!el) throw new Error('null result');
      return el;
    } catch {
      throw new SapScriptingError(
        `SAP element not found: "${fieldId}"\n` +
        'Tip: Use SAP GUI Script Recording (Customize > Script Recording & Playback) ' +
        'to capture exact field IDs.'
      );
    }
  }

  // ── Text operations ────────────────────────────────────────────────────
  setText(fieldId: string, value: string): void {
    const el = this.findById(fieldId);
    el.Text = value;
  }

  getText(fieldId: string): string {
    const el = this.findById(fieldId);
    return String(el.Text ?? '');
  }

  // ── Keyboard / navigation ──────────────────────────────────────────────
  /** Press a virtual key in the main window. key can be "Enter", "F3", "F8", or a numeric string */
  sendVKey(key: string, windowId = 'wnd[0]'): void {
    const vkNum = SAP_VKEYS[key] ?? parseInt(key, 10);
    if (isNaN(vkNum)) {
      throw new SapScriptingError(
        `Unknown SAP virtual key: "${key}". Valid values: ${Object.keys(SAP_VKEYS).join(', ')}`
      );
    }
    this.findById(windowId).sendVKey(vkNum);
  }

  /** Execute a TCode (transaction code) immediately */
  runTCode(tcode: string): void {
    this.getSession().StartTransaction(tcode.replace(/^\/[nN]/, ''));
  }

  // ── Button / menu ──────────────────────────────────────────────────────
  pressButton(fieldId: string): void {
    this.findById(fieldId).press();
  }

  selectMenu(menuPath: string): void {
    // menuPath format: "Menu item text" with > as separator: "Goto > Details"
    // In SAP scripting, menu items can be selected by path like:
    //   wnd[0]/mbar/menu[0]/menu[1]
    // We also support passing the raw SAP field ID directly
    const el = this.findById(menuPath);
    el.select?.() ?? el.press?.() ?? el.click?.();
  }

  // ── Combo box / dropdown ───────────────────────────────────────────────
  selectComboBox(fieldId: string, key: string): void {
    const el = this.findById(fieldId);
    el.Key = key;
  }

  // ── Checkbox ──────────────────────────────────────────────────────────
  setCheckbox(fieldId: string, checked: boolean): void {
    const el = this.findById(fieldId);
    el.Selected = checked;
  }

  // ── Tab strip ─────────────────────────────────────────────────────────
  selectTab(fieldId: string): void {
    this.findById(fieldId).Select();
  }

  // ── Status bar ────────────────────────────────────────────────────────
  getStatusBarText(): string {
    try {
      return String(this.findById('wnd[0]/sbar').Text ?? '');
    } catch {
      return '';
    }
  }

  getStatusBarType(): string {
    try {
      return String(this.findById('wnd[0]/sbar').MessageType ?? '');
    } catch {
      return '';
    }
  }

  // ── Table / Grid ───────────────────────────────────────────────────────
  /** Get a cell value from a GuiTableControl (classic ALV) */
  getTableCellText(tableId: string, row: number, column: number | string): string {
    const table = this.findById(tableId);
    const cell = table.getCellValue(row, column);
    return String(cell ?? '');
  }

  /** Double-click a grid row (forces field selection in most reports) */
  doubleClickTableCell(tableId: string, row: number, column: number | string): void {
    const col = typeof column === 'string' ? column : String(column);
    this.findById(tableId).doubleClickCurrentCell?.();
    this.findById(tableId).clickCurrentCell?.();
    // For GuiGridView (new ALV):
    this.findById(tableId).selectedRows?.add?.(row);
    this.findById(tableId).doubleClick?.(row, col) ??
      this.findById(tableId).pressEnter?.();
  }

  // ── Screenshot ────────────────────────────────────────────────────────
  takeScreenshot(outputDir: string, name: string): string {
    const ts = Date.now();
    const fileName = `${name.replace(/\s+/g, '-')}-${ts}.png`;
    const filePath = path.join(outputDir, fileName);
    try {
      const wnd = this.findById('wnd[0]');
      // hardCopyToClipboard exports the image; we save via shell
      wnd.hardCopy(filePath, 'PNG');
      console.log(`[SAP] Screenshot saved: ${filePath}`);
    } catch {
      console.warn(`[SAP] Screenshot failed (hardCopy not supported): ${filePath}`);
    }
    return filePath;
  }

  // ── Disconnect ────────────────────────────────────────────────────────
  disconnect(): void {
    try {
      if (this._session) {
        // End session cleanly
        try { this._session.findById('wnd[0]').close?.(); } catch { /* ignore */ }
      }
    } finally {
      this._session = null;
      this._engine = null;
      console.log('[SAP] Disconnected.');
    }
  }
}
