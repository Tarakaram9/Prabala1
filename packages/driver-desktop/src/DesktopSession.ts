// ─────────────────────────────────────────────────────────────────────────────
// Prabala Desktop Driver – Native Session (no Appium required)
//
// Uses OS accessibility APIs directly:
//   macOS   → osascript / JXA + System Events AX API
//   Windows → PowerShell + UIAutomationClient COM
//
// Exposes the same interface as before so index.ts needs no changes.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'child_process';
import * as fs     from 'fs';
import * as path   from 'path';
import * as os     from 'os';
import * as net    from 'net';
import * as http   from 'http';
import * as crypto from 'crypto';

export const isMac = process.platform === 'darwin';
export const isWin = process.platform === 'win32';

export interface DesktopLaunchOptions {
  appPath:    string;
  platform?:  string;
  appiumUrl?: string; // ignored — no Appium used
  timeout?:   number;
  cdpPort?:   number; // Electron remote-debugging-port (default 9222)
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level runners
// ─────────────────────────────────────────────────────────────────────────────

function jxaExec(script: string, timeoutMs = 15_000): string {
  try {
    return execFileSync('osascript', ['-l', 'JavaScript', '-e', script], {
      encoding: 'utf8', timeout: timeoutMs,
    }).trim();
  } catch (e: any) {
    throw new Error(((e.stderr || e.message) as string).trim() || 'JXA failed');
  }
}

function psExec(script: string, timeoutMs = 15_000): string {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8', timeout: timeoutMs,
    }).trim();
  } catch (e: any) {
    throw new Error(((e.stderr || e.message) as string).trim() || 'PS failed');
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// CDP (Chrome DevTools Protocol) — Electron app automation
// ─────────────────────────────────────────────────────────────────────────────

const CDP_DEFAULT_PORT = 9222;

/** Map a Prabala locator type+value to a CSS selector. */
function locatorToCss(type: string, val: string): string {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  switch (type) {
    case 'id':    return `#${val}`;
    case 'role':  return `[role="${esc(val)}"]`;
    case 'value': return `[value="${esc(val)}"]`;
    default:      return `[aria-label="${esc(val)}"]`; // name / default
  }
}

/** Wrap a CSS selector for safe embedding in a JS expression string. */
function cdpQ(css: string): string {
  return `document.querySelector("${css.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
}

/** Wrap a value string for safe embedding in a JS expression as a string literal. */
function cdpS(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

/**
 * Get the WebSocket debugger URL for the first page target from CDP.
 * Returns null if CDP is not listening on the port.
 */
function cdpGetTargetUrl(port: number, timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    http.get({ hostname: '127.0.0.1', port, path: '/json', timeout: timeoutMs }, (res) => {
      let d = '';
      res.on('data', (x: Buffer) => d += x);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const targets: any[] = JSON.parse(d);
          const pg = targets.find((t: any) => t.type === 'page') ?? targets[0];
          resolve(pg?.webSocketDebuggerUrl ?? null);
        } catch { resolve(null); }
      });
    }).on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

/**
 * Evaluate a JavaScript expression in the Electron page via CDP WebSocket.
 * Returns the primitive result value, or throws on JS exception / timeout.
 */
function cdpEval(wsUrl: string, expression: string, timeoutMs = 10_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(wsUrl);
    const port   = parseInt(parsed.port) || CDP_DEFAULT_PORT;
    const sock   = net.createConnection(port, parsed.hostname);
    const key    = crypto.randomBytes(16).toString('base64');
    let upgraded = false;
    let rxBuf    = Buffer.alloc(0);
    const timer  = setTimeout(() => { sock.destroy(); reject(new Error('CDP eval timeout')); }, timeoutMs);

    function sendFrame(text: string): void {
      const payload = Buffer.from(text, 'utf8');
      const mask    = crypto.randomBytes(4);
      const masked  = Buffer.allocUnsafe(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
      let header: number[];
      if (payload.length <= 125) {
        header = [0x81, 0x80 | payload.length, ...mask];
      } else if (payload.length <= 65535) {
        header = [0x81, 0xFE, (payload.length >> 8) & 0xFF, payload.length & 0xFF, ...mask];
      } else {
        clearTimeout(timer); sock.destroy();
        reject(new Error('CDP frame too large')); return;
      }
      sock.write(Buffer.concat([Buffer.from(header), masked]));
    }

    function parseFrame(buf: Buffer): { text: string; consumed: number } | null {
      if (buf.length < 2) return null;
      let plen = buf[1] & 0x7F; // server frames are not masked
      let off  = 2;
      if (plen === 126) {
        if (buf.length < 4) return null;
        plen = (buf[2] << 8) | buf[3]; off = 4;
      } else if (plen === 127) {
        if (buf.length < 10) return null;
        plen = buf.readUInt32BE(6); off = 10;
      }
      if (buf.length < off + plen) return null;
      return { text: buf.slice(off, off + plen).toString('utf8'), consumed: off + plen };
    }

    sock.on('connect', () => {
      sock.write([
        `GET ${parsed.pathname} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'));
    });

    sock.on('data', (data: Buffer) => {
      if (!upgraded) {
        if (data.toString('utf8').includes('HTTP/1.1 101')) {
          upgraded = true;
          const hEnd = data.indexOf('\r\n\r\n');
          if (hEnd !== -1) rxBuf = data.slice(hEnd + 4);
          sendFrame(JSON.stringify({
            id: 1, method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: false },
          }));
        }
        return;
      }
      rxBuf = Buffer.concat([rxBuf, data]);
      let fr: ReturnType<typeof parseFrame>;
      while ((fr = parseFrame(rxBuf)) !== null) {
        rxBuf = rxBuf.slice(fr.consumed);
        try {
          const msg: any = JSON.parse(fr.text);
          if (msg.id === 1) {
            clearTimeout(timer); sock.destroy();
            const exc = msg.result?.exceptionDetails;
            if (exc) reject(new Error(exc.exception?.description ?? exc.text ?? 'CDP exception'));
            else resolve(msg.result?.result?.value);
          }
        } catch { /* non-JSON or unrelated message */ }
      }
    });

    sock.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Locator / escape helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseLocator(loc: string): { type: string; value: string } {
  if (loc.startsWith('id='))    return { type: 'id',    value: loc.slice(3) };
  if (loc.startsWith('name='))  return { type: 'name',  value: loc.slice(5) };
  if (loc.startsWith('value=')) return { type: 'value', value: loc.slice(6) };
  if (loc.startsWith('role='))  return { type: 'role',  value: loc.slice(5) };
  if (loc.startsWith('xpath=')) return { type: 'name',  value: loc.slice(6) };
  return { type: 'name', value: loc };
}

/** Escape a string for safe embedding inside single-quoted JXA strings */
function ej(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/** Escape a string for safe embedding inside single-quoted PowerShell strings */
function ep(s: string): string { return s.replace(/'/g, "''"); }

// ─────────────────────────────────────────────────────────────────────────────
// macOS JXA scripts
// ─────────────────────────────────────────────────────────────────────────────

function macMatchExpr(type: string, v: string): string {
  switch (type) {
    case 'id':    return `(function(e){try{return e.identifier()==='${v}';}catch(x){return false;}})(el)`;
    case 'value': return `(function(e){try{var r=e.value();return r!==null&&String(r)==='${v}';}catch(x){return false;}})(el)`;
    case 'role':  return `(function(e){try{return e.role()==='${v}';}catch(x){return false;}})(el)`;
    default:      return `(function(e){try{if(e.name()==='${v}')return true;}catch(x){}try{if(e.description()==='${v}')return true;}catch(x){}return false;})(el)`;
  }
}

function macPreamble(app: string, type: string, val: string): string {
  const a = ej(app); const v = ej(val);
  const match = macMatchExpr(type, v);
  return (
    `ObjC.import('AppKit');\n` +
    `var se=Application('System Events');\n` +
    `var procs=se.processes.whose({name:'${a}'});\n` +
    `if(!procs.length)throw new Error('Process not found: ${a}');\n` +
    `var proc=procs[0];\n` +
    `var found=null;\n` +
    `function search(el,depth){` +
      `if(found||depth>10)return;` +
      `try{if(${match}){found=el;return;}}catch(e){}` +
      `var kids;try{kids=el.uiElements();}catch(e){return;}` +
      `for(var i=0;i<Math.min(kids.length,80);i++)search(kids[i],depth+1);}\n` +
    `search(proc,0);\n` +
    `if(!found)throw new Error('Element not found: ${type}=${v}');\n` +
    `var el=found;\n`
  );
}

function macClick(app: string, type: string, val: string): string {
  return macPreamble(app, type, val) +
    `var clicked=false;\n` +
    `try{el.actions.whose({name:'AXPress'})[0].perform();clicked=true;}catch(e){}\n` +
    `if(!clicked){try{\n` +
      `var pos=el.position();var sz=el.size();\n` +
      `var cx=pos[0]+sz[0]/2;var cy=pos[1]+sz[1]/2;\n` +
      `var dn=$.CGEventCreateMouseEvent(null,1,{x:cx,y:cy},0);\n` +
      `$.CGEventPost(0,dn);$.NSThread.sleepForTimeInterval(0.05);\n` +
      `var up=$.CGEventCreateMouseEvent(null,2,{x:cx,y:cy},0);\n` +
      `$.CGEventPost(0,up);clicked=true;}catch(e2){}}\n` +
    `if(!clicked)throw new Error('Could not click');\n` +
    `'ok'`;
}

function macRightClick(app: string, type: string, val: string): string {
  return macPreamble(app, type, val) +
    `var done=false;\n` +
    `try{el.actions.whose({name:'AXShowMenu'})[0].perform();done=true;}catch(e){}\n` +
    `if(!done){try{\n` +
      `var pos=el.position();var sz=el.size();\n` +
      `var cx=pos[0]+sz[0]/2;var cy=pos[1]+sz[1]/2;\n` +
      `var dn=$.CGEventCreateMouseEvent(null,3,{x:cx,y:cy},1);\n` +
      `$.CGEventPost(0,dn);$.NSThread.sleepForTimeInterval(0.05);\n` +
      `var up=$.CGEventCreateMouseEvent(null,4,{x:cx,y:cy},1);\n` +
      `$.CGEventPost(0,up);done=true;}catch(e2){}}\n` +
    `if(!done)throw new Error('Could not right-click');\n` +
    `'ok'`;
}

function macDblClick(app: string, type: string, val: string): string {
  return macPreamble(app, type, val) +
    `var pos=el.position();var sz=el.size();\n` +
    `var cx=pos[0]+sz[0]/2;var cy=pos[1]+sz[1]/2;\n` +
    `for(var n=0;n<2;n++){\n` +
      `var dn=$.CGEventCreateMouseEvent(null,1,{x:cx,y:cy},0);$.CGEventPost(0,dn);\n` +
      `$.NSThread.sleepForTimeInterval(0.03);\n` +
      `var up=$.CGEventCreateMouseEvent(null,2,{x:cx,y:cy},0);$.CGEventPost(0,up);\n` +
      `$.NSThread.sleepForTimeInterval(0.05);}\n` +
    `'ok'`;
}

function macSetVal(app: string, type: string, val: string, text: string): string {
  const t = ej(text);
  return macPreamble(app, type, val) +
    `try{el.actions.whose({name:'AXPress'})[0].perform();}catch(e){}\n` +
    `$.NSThread.sleepForTimeInterval(0.1);\n` +
    `se.keystroke('a',{using:['command down']});\n` +
    `$.NSThread.sleepForTimeInterval(0.05);\n` +
    `se.keystroke('${t}');\n` +
    `'ok'`;
}

function macClear(app: string, type: string, val: string): string {
  return macPreamble(app, type, val) +
    `try{el.actions.whose({name:'AXPress'})[0].perform();}catch(e){}\n` +
    `$.NSThread.sleepForTimeInterval(0.05);\n` +
    `se.keystroke('a',{using:['command down']});\n` +
    `$.NSThread.sleepForTimeInterval(0.05);\n` +
    `se.keyCode(51);\n` +
    `'ok'`;
}

function macGetText(app: string, type: string, val: string): string {
  return macPreamble(app, type, val) +
    `var txt='';\n` +
    `try{txt=el.name()||'';}catch(e){}\n` +
    `if(!txt)try{var v=el.value();txt=(v!==null&&v!==undefined)?String(v):'';}catch(e){}\n` +
    `if(!txt)try{txt=el.description()||'';}catch(e){}\n` +
    `if(txt==='null'||txt==='undefined')txt='';\n` +
    `txt`;
}

function macIsVisible(app: string, type: string, val: string): string {
  const a = ej(app); const v = ej(val);
  const match = macMatchExpr(type, v);
  return (
    `ObjC.import('AppKit');\n` +
    `var se=Application('System Events');\n` +
    `var procs=se.processes.whose({name:'${a}'});\n` +
    `if(!procs.length){'false';}else{\n` +
    `var proc=procs[0];var found=null;\n` +
    `function srch(el,depth){\n` +
      `if(found||depth>10)return;\n` +
      `try{if(${match}){found=el;return;}}catch(e){}\n` +
      `var kids;try{kids=el.uiElements();}catch(e){return;}\n` +
      `for(var i=0;i<Math.min(kids.length,80);i++)srch(kids[i],depth+1);}\n` +
    `srch(proc,0);\n` +
    `if(!found){'false';}else{var ok=true;try{ok=found.enabled();}catch(e){}ok?'true':'false';}}`
  );
}

function macIsEnabled(app: string, type: string, val: string): string {
  return macPreamble(app, type, val) +
    `var en=true;try{en=el.enabled();}catch(e){}en?'true':'false'`;
}

// ── keyboard ──────────────────────────────────────────────────────────────────

const MAC_KC: Record<string, number> = {
  Return:36,Enter:36,Tab:48,Space:49,Backspace:51,'Delete':51,Escape:53,Esc:53,
  ArrowLeft:123,ArrowRight:124,ArrowDown:125,ArrowUp:126,
  F1:122,F2:120,F3:99,F4:118,F5:96,F6:97,F7:98,F8:100,F9:101,F10:109,F11:103,F12:111,
  Home:115,End:119,PageUp:116,PageDown:121,Del:117,
};
const MAC_MOD: Record<string, string> = {
  Control:'control down',Ctrl:'control down',Shift:'shift down',
  Alt:'option down',Option:'option down',
  Meta:'command down',Command:'command down',Cmd:'command down',Win:'command down',
};

function macPressKey(key: string): void {
  const parts = key.split('+').map(k => k.trim());
  if (parts.length === 1) {
    const kc = MAC_KC[parts[0]];
    if (kc !== undefined) jxaExec(`Application('System Events').keyCode(${kc});`);
    else jxaExec(`Application('System Events').keystroke('${ej(parts[0])}');`);
  } else {
    const mods = parts.slice(0, -1).map(m => MAC_MOD[m] ?? 'command down');
    const main = parts[parts.length - 1];
    const ms = `[${mods.map(m => `'${m}'`).join(',')}]`;
    const kc = MAC_KC[main];
    if (kc !== undefined) jxaExec(`Application('System Events').keyCode(${kc},{using:${ms}});`);
    else jxaExec(`Application('System Events').keystroke('${ej(main)}',{using:${ms}});`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows PowerShell helpers
// ─────────────────────────────────────────────────────────────────────────────

const PS_HEAD = [
  `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes`,
  `$ae=[System.Windows.Automation.AutomationElement]; $root=$ae::RootElement`,
  `function Find-El($r,$lt,$lv,$d){`,
  `  if($d-gt8){return $null}`,
  `  $n=$r.GetCurrentPropertyValue($ae::NameProperty)`,
  `  $id=$r.GetCurrentPropertyValue($ae::AutomationIdProperty)`,
  `  $v=''; try{$v=$r.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value}catch{}`,
  `  $m=switch($lt){'id'{$id-eq$lv}'value'{$v-eq$lv}default{$n-eq$lv}}`,
  `  if($m){return $r}`,
  `  $kids=$r.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)`,
  `  foreach($c in $kids){$rr=Find-El $c $lt $lv ($d+1);if($rr){return $rr}}`,
  `  return $null`,
  `}`,
].join('\n');

function psClick(t: string, lt: string, lv: string): string {
  return `${PS_HEAD}
$win=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,(New-Object System.Windows.Automation.PropertyCondition($ae::NameProperty,'${ep(t)}']))
if(-not $win){throw "Window not found: ${ep(t)}"}
$el=Find-El $win '${ep(lt)}' '${ep(lv)}' 0; if(-not $el){throw "Not found: ${lt}=${lv}"}
try{$el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()}catch{
  $r=$el.GetCurrentPropertyValue($ae::BoundingRectangleProperty)
  $cx=[int]($r.Left+$r.Width/2);$cy=[int]($r.Top+$r.Height/2)
  Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y);[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int b,int e);' -Name Win32 -Namespace Mouse -ErrorAction SilentlyContinue
  [Mouse.Win32]::SetCursorPos($cx,$cy);[Mouse.Win32]::mouse_event(2,0,0,0,0);[Mouse.Win32]::mouse_event(4,0,0,0,0)}`;
}

function psGetText(t: string, lt: string, lv: string): string {
  return `${PS_HEAD}
$win=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,(New-Object System.Windows.Automation.PropertyCondition($ae::NameProperty,'${ep(t)}')))
if(-not $win){throw "Window not found"} $el=Find-El $win '${ep(lt)}' '${ep(lv)}' 0
if(-not $el){throw "Not found"} $el.GetCurrentPropertyValue($ae::NameProperty)`;
}

function psIsVis(t: string, lt: string, lv: string): string {
  return `${PS_HEAD}
$win=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,(New-Object System.Windows.Automation.PropertyCondition($ae::NameProperty,'${ep(t)}')))
if(-not $win){'false';exit} $el=Find-El $win '${ep(lt)}' '${ep(lv)}' 0
if(-not $el){'false';exit}
$off=$el.GetCurrentPropertyValue($ae::IsOffscreenProperty);if($off){'false'}else{'true'}`;
}

function psSetVal(t: string, lt: string, lv: string, tx: string): string {
  return `${PS_HEAD}
Add-Type -AssemblyName System.Windows.Forms
$win=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,(New-Object System.Windows.Automation.PropertyCondition($ae::NameProperty,'${ep(t)}')))
if(-not $win){throw "Window not found"} $el=Find-El $win '${ep(lt)}' '${ep(lv)}' 0
if(-not $el){throw "Not found"}
try{$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('${ep(tx)}')}catch{$el.SetFocus();[System.Windows.Forms.SendKeys]::SendWait('^a');[System.Windows.Forms.SendKeys]::SendWait('${ep(tx)}')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// NativeElement — proxy with same interface as WebdriverIO element
// ─────────────────────────────────────────────────────────────────────────────

export class NativeElement {
  constructor(private readonly s: DesktopSession, private readonly locator: string) {}
  private get p() { return parseLocator(this.locator); }

  async waitForDisplayed(o?: { timeout?: number; reverse?: boolean }): Promise<void> {
    const t = o?.timeout ?? this.s.defaultTimeout;
    if (o?.reverse) await this.s._waitForHidden(this.locator, t);
    else            await this.s._waitForVisible(this.locator, t);
  }

  async waitForEnabled(o?: { timeout?: number }): Promise<void> {
    const dl = Date.now() + (o?.timeout ?? this.s.defaultTimeout);
    while (Date.now() < dl) { if (await this.isEnabled()) return; await sleep(300); }
    throw new Error(`Timeout waiting for enabled: ${this.locator}`);
  }

  async click(o?: { button?: string }): Promise<void> {
    await this.s._click(this.locator, o?.button === 'right' ? 'right' : 'left');
  }

  async doubleClick(): Promise<void> {
    const { type, value } = this.p;
    if (isMac) jxaExec(macDblClick(this.s.appName, type, value));
    else { await this.click(); await sleep(80); await this.click(); }
  }

  async moveTo(): Promise<void> {}

  async setValue(v: string): Promise<void> {
    if (isMac && this.s.cdpWsUrl) {
      const css = locatorToCss(this.p.type, this.p.value);
      await cdpEval(this.s.cdpWsUrl,
        `(function(){var el=${cdpQ(css)};if(!el)throw new Error("CDP: not found: ${css.replace(/"/g, '\\"')}");` +
        `el.focus();el.value=${cdpS(v)};` +
        `el.dispatchEvent(new Event("input",{bubbles:true}));` +
        `el.dispatchEvent(new Event("change",{bubbles:true}));})()`
      );
      return;
    }
    const p = this.p;
    if (isMac) jxaExec(macSetVal(this.s.appName, p.type, p.value, v));
    else if (isWin) psExec(psSetVal(this.s.appName, p.type, p.value, v));
  }

  async clearValue(): Promise<void> {
    if (isMac && this.s.cdpWsUrl) {
      const css = locatorToCss(this.p.type, this.p.value);
      await cdpEval(this.s.cdpWsUrl,
        `(function(){var el=${cdpQ(css)};if(!el)throw new Error("CDP: not found");` +
        `el.focus();el.value="";` +
        `el.dispatchEvent(new Event("input",{bubbles:true}));` +
        `el.dispatchEvent(new Event("change",{bubbles:true}));})()`
      );
      return;
    }
    const p = this.p;
    if (isMac) jxaExec(macClear(this.s.appName, p.type, p.value));
    else if (isWin) psExec(psSetVal(this.s.appName, p.type, p.value, ''));
  }

  async isDisplayed(): Promise<boolean> { return this.s._isDisplayed(this.locator); }
  async isExisting():  Promise<boolean> { return this.s._isDisplayed(this.locator); }

  async isEnabled(): Promise<boolean> {
    const p = this.p;
    try { if (isMac) return jxaExec(macIsEnabled(this.s.appName, p.type, p.value), 5000) === 'true'; }
    catch { return false; }
    return true;
  }

  async getText(): Promise<string> {
    if (isMac && this.s.cdpWsUrl) {
      const css = locatorToCss(this.p.type, this.p.value);
      try {
        const v = await cdpEval(this.s.cdpWsUrl,
          `(function(){var el=${cdpQ(css)};if(!el)return "";` +
          `return el.textContent||el.value||el.getAttribute("aria-label")||"";})()`);
        return String(v ?? '');
      } catch { return ''; }
    }
    const p = this.p;
    if (isMac) return jxaExec(macGetText(this.s.appName, p.type, p.value)) ?? '';
    if (isWin) return psExec(psGetText(this.s.appName, p.type, p.value)) ?? '';
    return '';
  }

  async getAttribute(attr: string): Promise<string> {
    const p = this.p;
    if (isMac) {
      const axAttr = ej('AX' + attr.charAt(0).toUpperCase() + attr.slice(1));
      try {
        return jxaExec(
          macPreamble(this.s.appName, p.type, p.value) +
          `var val='';try{var r=Ref();ObjC.import('ApplicationServices');` +
          `if($.AXUIElementCopyAttributeValue(proc,$('${axAttr}'),r)===0){val=String(ObjC.unwrap(r[0]));}}catch(e){}` +
          `if(val==='null'||val==='undefined')val='';val`
        ) ?? '';
      } catch { return ''; }
    }
    return '';
  }

  async scrollIntoView(): Promise<void> {}
}

// ─────────────────────────────────────────────────────────────────────────────
// DesktopSession — main class
// ─────────────────────────────────────────────────────────────────────────────

export class DesktopSession {
  public appName        = '';
  public defaultTimeout = 30_000;
  public cdpWsUrl: string | null = null;

  // ── lifecycle ───────────────────────────────────────────────────────────────

  async launch(opts: DesktopLaunchOptions): Promise<void> {
    this.defaultTimeout = opts.timeout ?? 30_000;
    if (!isMac && !isWin) throw new Error('Desktop driver supports only macOS and Windows.');
    if (isMac) await this._macLaunch(opts.appPath, opts.cdpPort);
    else       await this._winLaunch(opts.appPath);
  }

  private async _tryConnectCdp(port: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const wsUrl = await cdpGetTargetUrl(port, 800);
      if (wsUrl) { this.cdpWsUrl = wsUrl; return; }
      await sleep(400);
    }
    // CDP not available — will fall back to JXA
  }

  private async _macLaunch(appPath: string, cdpPort?: number): Promise<void> {
    if (appPath.includes('/') || appPath.endsWith('.app')) {
      execFileSync('open', [appPath], { stdio: 'ignore' });
      this.appName = path.basename(appPath, '.app');
    } else {
      // bundle ID or application name
      try {
        execFileSync('open', ['-b', appPath], { stdio: 'ignore' });
        try {
          const n = jxaExec(
            `ObjC.import('AppKit');` +
            `var url=$.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier('${ej(appPath)}');` +
            `var n=url?ObjC.unwrap($.NSBundle.bundleWithURL(url).infoDictionary.objectForKey('CFBundleName')):'';` +
            `n||'${ej(appPath)}'`
          );
          this.appName = n || appPath;
        } catch { this.appName = appPath; }
      } catch {
        execFileSync('open', ['-a', appPath], { stdio: 'ignore' });
        this.appName = appPath;
      }
    }
    await this._waitForProcess(this.appName, 6000);
    await this._tryConnectCdp(cdpPort ?? CDP_DEFAULT_PORT);
  }

  private async _winLaunch(appPath: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawn } = require('child_process') as typeof import('child_process');
    spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref();
    this.appName = path.basename(appPath, '.exe');
    await sleep(2000);
  }

  private async _waitForProcess(name: string, ms: number): Promise<void> {
    const dl = Date.now() + ms;
    while (Date.now() < dl) {
      await sleep(400);
      try {
        if (jxaExec(`var se=Application('System Events');se.processes.whose({name:'${ej(name)}'}).length>0?'yes':'no'`, 3000) === 'yes') return;
      } catch { /* keep trying */ }
    }
  }

  async close(): Promise<void> {
    if (!this.appName) return;
    try {
      if (isMac) jxaExec(`try{Application('${ej(this.appName)}').quit();}catch(e){var se=Application('System Events');var p=se.processes.whose({name:'${ej(this.appName)}'});if(p.length)p[0].kill();}`, 5000);
      else if (isWin) psExec(`Stop-Process -Name '${ep(this.appName)}' -ErrorAction SilentlyContinue`);
    } catch { /* ignore */ }
  }

  async deleteSession(): Promise<void> { await this.close(); }

  // ── element API ─────────────────────────────────────────────────────────────

  async findElement(locator: string): Promise<NativeElement> { return new NativeElement(this, locator); }
  getDriver(): this { return this; }
  /** For index.ts AssertNotVisible: driver.$(locator) */
  async $(locator: string): Promise<NativeElement> { return new NativeElement(this, locator); }
  /** parseSelector is pass-through in native mode */
  parseSelector(locator: string): string { return locator; }

  // ── internal helpers ────────────────────────────────────────────────────────

  async _click(locator: string, button: 'left' | 'right' = 'left'): Promise<void> {
    if (isMac && this.cdpWsUrl && button === 'left') {
      const { type, value } = parseLocator(locator);
      const css = locatorToCss(type, value);
      await cdpEval(this.cdpWsUrl,
        `(function(){var el=${cdpQ(css)};if(!el)throw new Error("CDP: not found: ${css.replace(/"/g, '\\"')}");el.click();})()`
      );
      return;
    }
    const { type, value } = parseLocator(locator);
    if (isMac) jxaExec(button === 'right' ? macRightClick(this.appName, type, value) : macClick(this.appName, type, value));
    else if (isWin) psExec(psClick(this.appName, type, value));
  }

  async _isDisplayed(locator: string): Promise<boolean> {
    if (isMac && this.cdpWsUrl) {
      const { type, value } = parseLocator(locator);
      const css = locatorToCss(type, value);
      try {
        const v = await cdpEval(this.cdpWsUrl,
          `(function(){var el=${cdpQ(css)};if(!el)return false;` +
          `var s=window.getComputedStyle(el);` +
          `return s.display!=="none"&&s.visibility!=="hidden"&&el.offsetParent!==null;})()`
        , 5000);
        return v === true;
      } catch { return false; }
    }
    const { type, value } = parseLocator(locator);
    try {
      if (isMac) return jxaExec(macIsVisible(this.appName, type, value), 5000) === 'true';
      if (isWin) return psExec(psIsVis(this.appName, type, value), 5000).trim() === 'true';
    } catch { return false; }
    return false;
  }

  async _waitForVisible(locator: string, ms: number): Promise<void> {
    const dl = Date.now() + ms; let last = '';
    while (Date.now() < dl) {
      try { if (await this._isDisplayed(locator)) return; } catch (e: any) { last = e.message; }
      await sleep(300);
    }
    throw new Error(`Timeout waiting visible: ${locator}. ${last}`);
  }

  async _waitForHidden(locator: string, ms: number): Promise<void> {
    const dl = Date.now() + ms;
    while (Date.now() < dl) {
      try { if (!(await this._isDisplayed(locator))) return; } catch { return; }
      await sleep(300);
    }
    throw new Error(`Timeout waiting hidden: ${locator}`);
  }

  // ── keyboard ────────────────────────────────────────────────────────────────

  async pressKey(key: string): Promise<void> {
    if (isMac) macPressKey(key);
    else if (isWin) psExec(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${ep(key)}')`);
  }

  async keys(ks: string[]): Promise<void> { for (const k of ks) await this.pressKey(k); }

  // ── window management ────────────────────────────────────────────────────────

  async maximizeWindow(): Promise<void> {
    if (isMac) jxaExec(`ObjC.import('AppKit');try{Application('${ej(this.appName)}').windows[0].zoom();}catch(e){}`);
  }

  async minimizeWindow(): Promise<void> {
    if (isMac) jxaExec(`try{Application('${ej(this.appName)}').windows[0].miniaturized=true;}catch(e){}`);
  }

  async setWindowSize(w: number, h: number): Promise<void> {
    if (isMac) jxaExec(`try{Application('${ej(this.appName)}').windows[0].bounds={x:0,y:0,width:${w},height:${h}};}catch(e){}`);
  }

  // ── scroll ───────────────────────────────────────────────────────────────────

  async performActions(actions: any[]): Promise<void> {
    for (const action of actions) {
      if (action.type !== 'wheel') continue;
      for (const a of (action.actions ?? [])) {
        if (a.type !== 'scroll') continue;
        const sv = Math.round(-(a.deltaY ?? 0) / 30);
        const sh = Math.round(-(a.deltaX ?? 0) / 30);
        if (isMac) try { jxaExec(`ObjC.import('AppKit');var e=$.CGEventCreateScrollWheelEvent(null,1,2,${sv},${sh});$.CGEventPost(0,e);`); } catch { /* ignore */ }
      }
    }
  }

  async releaseActions(): Promise<void> {}

  // ── screenshot ───────────────────────────────────────────────────────────────

  async takeScreenshot(): Promise<string> {
    const tmp = path.join(os.tmpdir(), `prabala-ss-${Date.now()}.png`);
    try {
      if (isMac) execFileSync('screencapture', ['-x', '-t', 'png', tmp], { stdio: 'ignore' });
      else if (isWin) psExec(
        `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;` +
        `$b=New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height);` +
        `$g=[System.Drawing.Graphics]::FromImage($b);$g.CopyFromScreen(0,0,0,0,$b.Size);` +
        `$b.Save('${ep(tmp)}',[System.Drawing.Imaging.ImageFormat]::Png)`
      );
      if (!fs.existsSync(tmp)) return '';
      return fs.readFileSync(tmp).toString('base64');
    } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}
