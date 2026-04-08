// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Desktop Action Recorder  (no Appium, no Xcode required)
//
// Uses native OS accessibility APIs directly:
//   macOS   — osascript / JXA  (JavaScript for Automation, built into every Mac)
//   Windows — PowerShell + UIAutomationClient COM  (built into every Windows)
//
// Args:  <appPath> [unused]
//   appPath   Path to .app / .exe to launch, OR bundle ID / exe name to attach.
//             Pass empty string "" to attach to the frontmost/active window.
//
// Output (one JSON per line on stdout):
//   { "keyword": "Desktop.Click",     "params": { "locator": "name=Login" } }
//   { "keyword": "Desktop.EnterText", "params": { "locator": "name=Username", "value": "admin" } }
//   { "__screenshot": "<base64 png>", "__screenshotType": "png", "width": N, "height": N }
//   { "__done": true }
//   { "__error": "<message>" }
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { spawn, execSync, execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const appArg = (process.argv[2] || '').trim();
const isMac  = process.platform === 'darwin';
const isWin  = process.platform === 'win32';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ── Locator helpers ───────────────────────────────────────────────────────────

function bestLocatorFromAttrs(attrs) {
  // Priority: AXIdentifier > AXTitle/AXDescription/AXValue (trimmed, short) > role+index
  const id  = attrs.AXIdentifier || attrs.AutomationId;
  if (id  && id.trim())  return `id=${id.trim()}`;
  const lbl = attrs.AXTitle || attrs.AXDescription || attrs.name || attrs.label;
  if (lbl && lbl.trim() && lbl.trim().length < 60) return `name=${lbl.trim()}`;
  const val = attrs.AXValue || attrs.value;
  if (val && val.trim() && val.trim().length < 60) return `value=${val.trim()}`;
  const role = attrs.AXRole || attrs.ControlType || attrs.role || 'Element';
  return `role=${role}`;
}

// ── Screenshot ────────────────────────────────────────────────────────────────

let lastScreenshotHash = '';
const SCREENSHOT_INTERVAL_MS = 600;

async function captureScreenshot() {
  try {
    const tmp = path.join(os.tmpdir(), `prabala-screen-${Date.now()}.png`);
    if (isMac) {
      execFileSync('screencapture', ['-x', '-t', 'png', tmp], { stdio: 'ignore' });
    } else if (isWin) {
      // PowerShell one-liner: capture screen to PNG
      const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $b=New-Object System.Drawing.Bitmap($bmp.Width,$bmp.Height); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $b.Save('${tmp.replace(/\\/g,'\\\\')}',[System.Drawing.Imaging.ImageFormat]::Png)`;
      execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    } else {
      return; // unsupported platform
    }
    if (!fs.existsSync(tmp)) return;
    const data = fs.readFileSync(tmp).toString('base64');
    fs.unlinkSync(tmp);
    if (data === lastScreenshotHash) return;
    lastScreenshotHash = data;
    emit({ __screenshot: data, __screenshotType: 'png', width: 1280, height: 800 });
  } catch { /* screenshot is best-effort */ }
}

// ═════════════════════════════════════════════════════════════════════════════
// macOS — JXA via osascript
// ═════════════════════════════════════════════════════════════════════════════

// JXA script that dumps the AX tree of the target app as JSON.
// We run this via: osascript -l JavaScript -e "<script>" <appName>
const JXA_DUMP = `
ObjC.import('AppKit');
ObjC.import('Cocoa');

var args = $.NSProcessInfo.processInfo.arguments;
var targetName = (args.count > 4) ? ObjC.unwrap(args.objectAtIndex(4)) : '';

function axDump(el, depth) {
  if (depth > 6) return null;
  var role, title, value, id, focused, enabled;
  try { role    = ObjC.unwrap(el.AXRole) || ''; } catch(e) { role = ''; }
  try { title   = ObjC.unwrap(el.AXTitle) || ObjC.unwrap(el.AXDescription) || ''; } catch(e) { title = ''; }
  try { value   = ObjC.unwrap(el.AXValue); if (typeof value !== 'string') value = ''; } catch(e) { value = ''; }
  try { id      = ObjC.unwrap(el.AXIdentifier) || ''; } catch(e) { id = ''; }
  try { focused = el.AXFocused == true; } catch(e) { focused = false; }
  try { enabled = el.AXEnabled != false; } catch(e) { enabled = true; }

  var node = { role: role, title: title, value: value, id: id, focused: focused, enabled: enabled, children: [] };

  var children;
  try { children = ObjC.unwrap(el.AXChildren) || []; } catch(e) { children = []; }
  for (var i = 0; i < children.length && i < 80; i++) {
    var child = axDump(children[i], depth + 1);
    if (child) node.children.push(child);
  }
  return node;
}

function getApp() {
  var wsApps = ObjC.unwrap($.NSWorkspace.sharedWorkspace.runningApplications);
  if (!targetName) {
    // Frontmost app
    var front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    return Application(ObjC.unwrap(front.localizedName));
  }
  for (var i = 0; i < wsApps.length; i++) {
    var a = wsApps[i];
    var name = ObjC.unwrap(a.localizedName) || '';
    var bid  = ObjC.unwrap(a.bundleIdentifier) || '';
    if (name.toLowerCase() === targetName.toLowerCase() || bid.toLowerCase() === targetName.toLowerCase()) {
      return Application(name);
    }
  }
  return null;
}

var app = getApp();
if (!app) { JSON.stringify({ error: 'App not found: ' + targetName }); }
else {
  try {
    var axApp = app.windows[0];
    var result = [];
    var wins = app.windows();
    for (var w = 0; w < wins.length && w < 3; w++) {
      // Use System Events for AX tree
    }
    // Use System Events AX
    var se = Application('System Events');
    var proc = se.processes.whose({ name: app.name() })[0];
    var tree = axDump(proc, 0);
    JSON.stringify(tree);
  } catch(e) {
    JSON.stringify({ error: String(e) });
  }
}
`.trim();

// Simpler, faster JXA that uses System Events directly
const JXA_AX = `
ObjC.import('AppKit');
var targetName = $.NSProcessInfo.processInfo.arguments.count > 4
  ? ObjC.unwrap($.NSProcessInfo.processInfo.arguments.objectAtIndex(4)) : '';

function flatten(el, depth, out) {
  if (!el || depth > 7) return;
  var role='', title='', val='', axid='', focused=false;
  try { role  = ObjC.unwrap(el.role()) || ''; }    catch(e){}
  try { title = ObjC.unwrap(el.title()) || ObjC.unwrap(el.description()) || ''; } catch(e){}
  try { var v = el.value(); val = (typeof v === 'string') ? v : (v != null ? String(v) : ''); } catch(e){}
  try { focused = el.focused() === true; } catch(e){}
  if (role) out.push({ role, title, val, focused });
  try {
    var kids = el.uiElements();
    for (var i=0; i<kids.length && i<60; i++) flatten(kids[i], depth+1, out);
  } catch(e){}
}

var se = Application('System Events');
var proc;
if (targetName) {
  try { proc = se.processes.whose({name: targetName})[0]; } catch(e){}
  if (!proc) {
    var allNames = se.processes().map(function(p){ try{return p.name();}catch(e){return '';} });
    for (var i=0; i<allNames.length; i++) {
      if (allNames[i].toLowerCase().indexOf(targetName.toLowerCase()) >= 0) {
        proc = se.processes[i]; break;
      }
    }
  }
} else {
  // frontmost
  var front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  var fname = ObjC.unwrap(front.localizedName);
  try { proc = se.processes.whose({name: fname})[0]; } catch(e){}
}
if (!proc) { JSON.stringify({error: 'Process not found'}); }
else {
  var nodes = [];
  flatten(proc, 0, nodes);
  JSON.stringify(nodes);
}
`.trim();

function runJxa(script, extra) {
  const args = ['-l', 'JavaScript', '-e', script];
  if (extra) args.push(extra);
  const out = execFileSync('osascript', args, { encoding: 'utf8', timeout: 8000 });
  return JSON.parse(out.trim() || 'null');
}

// ── macOS: JXA monitor script (synchronous polling loop) ─────────────────────
// Polls every 150 ms using NSThread.sleepForTimeInterval (works reliably in
// osascript context — no NSRunLoop/NSTimer/addGlobalMonitor required).
// Detects clicks via NSEvent.pressedMouseButtons + AXUIElementCopyElementAtPosition.
// Detects text-field changes via AXFocusedUIElement value tracking.
const JXA_MONITOR = `
ObjC.import('AppKit');
ObjC.import('ApplicationServices');

// ── args ───────────────────────────────────────────────────────────────────
var pargs = $.NSProcessInfo.processInfo.arguments;
// argv: [osascript, -l, JavaScript, scriptPath, targetName?]
var targetName = pargs.count > 4 ? ObjC.unwrap(pargs.objectAtIndex(4)) : '';

// ── stdout helper ──────────────────────────────────────────────────────────
var stdout = $.NSFileHandle.fileHandleWithStandardOutput;
function emitLine(obj) {
  try {
    stdout.writeData($(JSON.stringify(obj) + '\\n').dataUsingEncoding(4));
  } catch(e) {}
}

// ── AX helpers ─────────────────────────────────────────────────────────────
var sysWide = $.AXUIElementCreateSystemWide();

function axAttr(el, attr) {
  try {
    var r = Ref();
    if ($.AXUIElementCopyAttributeValue(el, $(attr), r) !== 0) return '';
    var v = ObjC.unwrap(r[0]);
    return (typeof v === 'string') ? v : '';
  } catch(e) { return ''; }
}

function locatorFor(el) {
  var id = axAttr(el, 'AXIdentifier');
  if (id && id.trim() && id.length < 80) return 'id=' + id.trim();
  var title = axAttr(el, 'AXTitle') || axAttr(el, 'AXDescription');
  if (title && title.trim() && title.length < 80) return 'name=' + title.trim();
  var val = axAttr(el, 'AXValue');
  if (val && val.trim() && val.length < 60) return 'value=' + val.trim();
  return 'role=' + (axAttr(el, 'AXRole') || 'Element');
}

// ── state ──────────────────────────────────────────────────────────────────
var lastDown     = false;
var prevTextKey  = '';
var prevTextVal  = '';
var screenH      = ObjC.unwrap($.NSScreen.mainScreen.frame).size.height;
var TEXT_ROLES   = ['AXTextField','AXTextArea','AXComboBox','AXSearchField','AXSecureTextField'];

emitLine({ __ready: true });

// ── main loop ──────────────────────────────────────────────────────────────
while (true) {
  $.NSThread.sleepForTimeInterval(0.15);

  // ── click detection ──────────────────────────────────────────────────
  try {
    var down = ($.NSEvent.pressedMouseButtons & 1) === 1;
    if (down && !lastDown) {
      var mLoc = $.NSEvent.mouseLocation;
      // NSEvent y is from bottom-left; AX wants y from top-left → flip
      var elRef = Ref();
      if ($.AXUIElementCopyElementAtPosition(sysWide, mLoc.x, screenH - mLoc.y, elRef) === 0) {
        emitLine({ keyword: 'Desktop.Click', params: { locator: locatorFor(elRef[0]) } });
      }
    }
    lastDown = down;
  } catch(e) {}

  // ── text-field value change detection ────────────────────────────────
  try {
    var focRef = Ref();
    if ($.AXUIElementCopyAttributeValue(sysWide, $('AXFocusedUIElement'), focRef) === 0) {
      var focEl  = focRef[0];
      var role   = axAttr(focEl, 'AXRole');
      if (TEXT_ROLES.indexOf(role) >= 0) {
        var title  = axAttr(focEl, 'AXTitle') || axAttr(focEl, 'AXDescription') || '';
        var curVal = axAttr(focEl, 'AXValue') || '';
        var key    = role + ':' + title;
        if (key !== prevTextKey) {
          // newly focused field — reset baseline, do not emit
          prevTextKey = key;
          prevTextVal = curVal;
        } else if (curVal !== prevTextVal && curVal.trim()) {
          var loc = title ? 'name=' + title.trim() : 'role=' + role;
          emitLine({ keyword: 'Desktop.EnterText', params: { locator: loc, value: curVal } });
          prevTextVal = curVal;
        }
      }
    }
  } catch(e) {}
}
`.trim();

// ── macOS: launch app ─────────────────────────────────────────────────────────

function macLaunchApp(appPath) {
  if (appPath.endsWith('.app')) {
    execFileSync('open', ['-a', appPath], { stdio: 'ignore' });
    // Wait up to 3s for it to appear
    for (let i = 0; i < 6; i++) {
      execSync('sleep 0.5');
    }
    return path.basename(appPath, '.app');
  }
  // Already a name/bundle id
  return appPath;
}

// ── macOS diff+record loop ────────────────────────────────────────────────────

function macNodeKey(n) {
  if (n.title && n.title.length < 60) return `${n.role}:${n.title}`;
  if (n.val   && n.val.length   < 60) return `${n.role}:val:${n.val}`;
  return `${n.role}`;
}

function macLocator(n) {
  if (n.title && n.title.trim()) return `name=${n.title.trim()}`;
  if (n.val   && n.val.trim())   return `value=${n.val.trim()}`;
  return `role=${n.role}`;
}

const TEXT_ROLES_MAC = new Set(['AXTextField', 'AXTextArea', 'AXComboBox', 'AXSearchField']);

let prevMacNodes = null;
let prevMacFocused = null;

function diffMacNodes(curr) {
  if (!prevMacNodes) { prevMacNodes = curr; return []; }

  const prevMap = new Map();
  prevMacNodes.forEach(n => prevMap.set(macNodeKey(n), n));
  const currMap = new Map();
  curr.forEach(n => currMap.set(macNodeKey(n), n));

  const steps = [];

  // Focused element changed → Click (unless text input)
  const currFocused = curr.find(n => n.focused);
  const prevFocused = prevMacNodes.find(n => n.focused);
  const currFocKey  = currFocused ? macNodeKey(currFocused) : null;
  const prevFocKey  = prevFocused ? macNodeKey(prevFocused) : null;

  if (currFocKey && currFocKey !== prevFocKey) {
    if (!TEXT_ROLES_MAC.has(currFocused.role)) {
      steps.push({ keyword: 'Desktop.Click', params: { locator: macLocator(currFocused) } });
    }
    prevMacFocused = currFocKey;
  }

  // Value changed on a text input → EnterText
  for (const [key, cn] of currMap) {
    const pn = prevMap.get(key);
    if (!pn) continue;
    if (TEXT_ROLES_MAC.has(cn.role) && cn.val !== pn.val && cn.val.trim()) {
      steps.push({ keyword: 'Desktop.EnterText', params: { locator: macLocator(cn), value: cn.val } });
    }
  }

  prevMacNodes = curr;
  return steps;
}

// ═════════════════════════════════════════════════════════════════════════════
// Windows — PowerShell UIAutomation
// ═════════════════════════════════════════════════════════════════════════════

const PS_DUMP = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ae = [System.Windows.Automation.AutomationElement]
$root = $ae::RootElement
$targetName = $args[0]
function Flatten($el, $depth) {
  if ($depth -gt 6) { return }
  $props = $el.GetCurrentPropertyValue($ae::NameProperty)
  $role  = $el.GetCurrentPropertyValue($ae::ControlTypeProperty).ProgrammaticName
  $aid   = $el.GetCurrentPropertyValue($ae::AutomationIdProperty)
  $val   = ''
  try {
    $vp = [System.Windows.Automation.ValuePattern]
    $vobj = $el.GetCurrentPattern($vp::Pattern)
    $val = $vobj.Current.Value
  } catch {}
  $focused = $el.GetCurrentPropertyValue($ae::HasKeyboardFocusProperty)
  [PSCustomObject]@{ role=$role; name=$props; val=$val; id=$aid; focused=$focused }
  $cond = [System.Windows.Automation.Condition]::TrueCondition
  $children = $el.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  foreach ($c in $children) { Flatten $c ($depth+1) }
}
if ($targetName) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($ae::NameProperty, $targetName)
  $win  = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
  if (-not $win) { Write-Output '[]'; exit }
  @(Flatten $win 0) | ConvertTo-Json -Compress
} else {
  $fw = [System.Windows.Automation.AutomationElement]::FocusedElement
  if (-not $fw) { Write-Output '[]'; exit }
  $proc = $fw
  while ($proc.CachedParent -and $proc.CachedParent -ne $root) { $proc = $proc.CachedParent }
  @(Flatten $proc 0) | ConvertTo-Json -Compress
}
`;

function runPs(script, extra) {
  const args = ['-NoProfile', '-Command', script];
  if (extra) args.push(extra);
  const out = execFileSync('powershell', args, { encoding: 'utf8', timeout: 8000 });
  return JSON.parse(out.trim() || '[]');
}

function winLaunchApp(appPath) {
  spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref();
  execSync('timeout /t 2 /nobreak > nul', { shell: true });
  return path.basename(appPath, '.exe');
}

function winLocator(n) {
  if (n.id   && n.id.trim())   return `id=${n.id.trim()}`;
  if (n.name && n.name.trim()) return `name=${n.name.trim()}`;
  return `role=${n.role}`;
}

const TEXT_ROLES_WIN = new Set([
  'ControlType.Edit', 'ControlType.Document', 'ControlType.ComboBox'
]);

let prevWinNodes = null;

function diffWinNodes(curr) {
  if (!prevWinNodes) { prevWinNodes = curr; return []; }

  const prevMap = new Map();
  prevWinNodes.forEach(n => prevMap.set(winLocator(n), n));
  const currMap = new Map();
  curr.forEach(n => currMap.set(winLocator(n), n));

  const steps = [];

  const currFocused = curr.find(n => n.focused === true || n.focused === 'True');
  const prevFocused = prevWinNodes.find(n => n.focused === true || n.focused === 'True');

  if (currFocused && winLocator(currFocused) !== (prevFocused ? winLocator(prevFocused) : '')) {
    if (!TEXT_ROLES_WIN.has(currFocused.role)) {
      steps.push({ keyword: 'Desktop.Click', params: { locator: winLocator(currFocused) } });
    }
  }

  for (const [loc, cn] of currMap) {
    const pn = prevMap.get(loc);
    if (!pn) continue;
    if (TEXT_ROLES_WIN.has(cn.role) && cn.val !== pn.val && cn.val && cn.val.trim()) {
      steps.push({ keyword: 'Desktop.EnterText', params: { locator: loc, value: cn.val } });
    }
  }

  prevWinNodes = curr;
  return steps;
}

// ═════════════════════════════════════════════════════════════════════════════
// CDP recorder — for Electron apps
// ═════════════════════════════════════════════════════════════════════════════

const http = require('http');
const net  = require('net');
const crypto = require('crypto');

/** Poll CDP /json until a page target appears, or return null on timeout. */
function detectCdp(port, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      http.get({ hostname: '127.0.0.1', port, path: '/json', timeout: 600 }, (res) => {
        let d = '';
        res.on('data', x => d += x);
        res.on('end', () => {
          try {
            const targets = JSON.parse(d);
            const pg = targets.find(t => t.type === 'page') || targets[0];
            resolve(pg ? pg.webSocketDebuggerUrl : null);
          } catch { tryLater(); }
        });
      }).on('error', () => tryLater());
    }
    function tryLater() {
      if (Date.now() < deadline) setTimeout(attempt, 400);
      else resolve(null);
    }
    attempt();
  });
}

/** Map an element's attributes to the best Prabala locator (name= preferred). */
function cdpBestLocator(el) {
  if (el.ariaLabel)      return `name=${el.ariaLabel}`;
  if (el.id && !/^\d/.test(el.id)) return `id=${el.id}`;
  if (el.placeholder)   return `name=${el.placeholder}`;
  if (el.name && el.tag === 'button') return `name=${el.name}`;
  if (el.textContent)   return `name=${el.textContent}`;
  return `role=${el.role || 'Element'}`;
}

/** Send one CDP command over a WebSocket and return the result. */
function cdpSend(sock, send, id, method, params) {
  send(JSON.stringify({ id, method, params }));
}

/**
 * Inject a CDP event listener script into the page that emits click / input
 * events back to us via Runtime.bindingCalled, then stream those events.
 */
async function runCdpRecorder(wsUrl) {
  const url  = new URL(wsUrl);
  const port = parseInt(url.port) || 9222;

  await new Promise((resolve) => {
    const sock = net.createConnection(port, url.hostname);
    const key  = crypto.randomBytes(16).toString('base64');
    let upgraded = false, rxBuf = Buffer.alloc(0), cmdId = 1;

    function send(text) {
      const p = Buffer.from(text, 'utf8');
      const m = crypto.randomBytes(4);
      const ms = Buffer.allocUnsafe(p.length);
      for (let i = 0; i < p.length; i++) ms[i] = p[i] ^ m[i % 4];
      const hdr = p.length <= 125
        ? [0x81, 0x80 | p.length, ...m]
        : [0x81, 0xFE, (p.length >> 8) & 0xFF, p.length & 0xFF, ...m];
      sock.write(Buffer.concat([Buffer.from(hdr), ms]));
    }

    function parseFrames(buf) {
      const frames = [];
      while (buf.length >= 2) {
        let plen = buf[1] & 0x7F, off = 2;
        if (plen === 126) { if (buf.length < 4) break; plen = (buf[2] << 8) | buf[3]; off = 4; }
        else if (plen === 127) { if (buf.length < 10) break; plen = buf.readUInt32BE(6); off = 10; }
        if (buf.length < off + plen) break;
        frames.push(buf.slice(off, off + plen).toString('utf8'));
        buf = buf.slice(off + plen);
      }
      return { frames, remaining: buf };
    }

    // JS injected into the Electron page to capture clicks + text input
    const INJECT = `
(function() {
  if (window.__prabalaRecActive) return;
  window.__prabalaRecActive = true;

  function bestLocator(el) {
    if (!el) return 'role=Element';
    var a = el.getAttribute('aria-label'); if (a) return 'name=' + a;
    if (el.id && !/^\\d/.test(el.id)) return 'id=' + el.id;
    var ph = el.getAttribute('placeholder'); if (ph) return 'name=' + ph;
    var txt = (el.innerText || el.textContent || '').trim().replace(/\\s+/g,' ').slice(0,50);
    if (txt && !['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) return 'name=' + txt;
    return 'role=' + (el.getAttribute('role') || el.tagName.toLowerCase());
  }

  // Click capture
  document.addEventListener('click', function(e) {
    var el = e.target;
    window.__prabalaEvent(JSON.stringify({ type:'click', locator: bestLocator(el) }));
  }, true);

  // Text input capture (debounced 600ms after last keystroke)
  var inputTimers = new WeakMap();
  document.addEventListener('input', function(e) {
    var el = e.target;
    if (!['INPUT','TEXTAREA'].includes(el.tagName)) return;
    if (inputTimers.has(el)) clearTimeout(inputTimers.get(el));
    inputTimers.set(el, setTimeout(function() {
      window.__prabalaEvent(JSON.stringify({ type:'input', locator: bestLocator(el), value: el.value }));
    }, 600));
  }, true);

  // Select change
  document.addEventListener('change', function(e) {
    var el = e.target;
    if (el.tagName !== 'SELECT') return;
    window.__prabalaEvent(JSON.stringify({ type:'select', locator: bestLocator(el), value: el.value }));
  }, true);
})();
`.trim();

    sock.on('connect', () => {
      sock.write([
        `GET ${url.pathname} HTTP/1.1`,
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'));
    });

    sock.on('data', (data) => {
      if (!upgraded) {
        if (data.toString('utf8').includes('HTTP/1.1 101')) {
          upgraded = true;
          const hEnd = data.indexOf('\r\n\r\n');
          if (hEnd !== -1) rxBuf = data.slice(hEnd + 4);
          // Step 1: add a binding that the injected script can call
          cdpSend(sock, send, cmdId++, 'Runtime.addBinding', { name: '__prabalaEvent' });
        }
        return;
      }

      rxBuf = Buffer.concat([rxBuf, data]);
      const parsed = parseFrames(rxBuf);
      rxBuf = parsed.remaining;

      for (const text of parsed.frames) {
        let msg;
        try { msg = JSON.parse(text); } catch { continue; }

        // After addBinding ack, inject the recorder script
        if (msg.id === 1 && msg.result !== undefined) {
          cdpSend(sock, send, cmdId++, 'Runtime.evaluate', {
            expression: INJECT, returnByValue: true
          });
        }

        // Runtime.bindingCalled carries our events
        if (msg.method === 'Runtime.bindingCalled' && msg.params && msg.params.name === '__prabalaEvent') {
          try {
            const ev = JSON.parse(msg.params.payload);
            if (ev.type === 'click') {
              emit({ keyword: 'Desktop.Click', params: { locator: ev.locator } });
            } else if (ev.type === 'input' && ev.value) {
              emit({ keyword: 'Desktop.EnterText', params: { locator: ev.locator, value: ev.value } });
            } else if (ev.type === 'select') {
              emit({ keyword: 'Desktop.EnterText', params: { locator: ev.locator, value: ev.value } });
            }
          } catch { /* ignore */ }
          captureScreenshot();
        }
      }
    });

    sock.on('error', (err) => {
      emit({ __error: `CDP recorder error: ${err.message}` });
      resolve();
    });

    // Stop on process signal
    function cleanup() {
      try { sock.destroy(); } catch { /* ignore */ }
      resolve();
    }
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('message', (msg) => { if (msg && msg.type === 'stop') cleanup(); });

    const screenshotTimer = setInterval(captureScreenshot, SCREENSHOT_INTERVAL_MS);
    sock.on('close', () => {
      clearInterval(screenshotTimer);
      resolve();
    });
  });

  emit({ __done: true });
  process.exit(0);
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════

const POLL_MS         = 400;
const MAX_ERRORS      = 8;
let polling = true;
let stopping = false;

async function run() {
  if (!isMac && !isWin) {
    emit({ __error: 'Desktop recording is only supported on macOS and Windows.' });
    emit({ __done: true });
    return;
  }

  // ── Launch or attach ───────────────────────────────────────────────────────
  let targetName = appArg;
  try {
    if (appArg) {
      if (isMac) {
        targetName = macLaunchApp(appArg);
        emit({ keyword: 'Desktop.LaunchApp', params: { appPath: appArg, platform: 'mac' } });
      } else {
        targetName = winLaunchApp(appArg);
        emit({ keyword: 'Desktop.LaunchApp', params: { appPath: appArg, platform: 'windows' } });
      }
    }
  } catch (err) {
    emit({ __error: `Failed to launch app: ${err.message}` });
    emit({ __done: true });
    return;
  }

  process.stderr.write(`[Desktop Recorder] Attaching to: "${targetName || 'frontmost'}"\n`);

  // ── Initial screenshot ─────────────────────────────────────────────────────
  await captureScreenshot();

  // ── macOS: try CDP first (Electron apps), fall back to JXA ──────────────────
  if (isMac) {
    const cdpWsUrl = await detectCdp(9222, 3000);
    if (cdpWsUrl) {
      process.stderr.write(`[Desktop Recorder] Electron app detected — using CDP recorder\n`);
      await runCdpRecorder(cdpWsUrl);
      return;
    }

    const tmpScript = path.join(os.tmpdir(), `prabala-recorder-${Date.now()}.js`);
    fs.writeFileSync(tmpScript, JXA_MONITOR, 'utf8');
    process.stderr.write(`[Desktop Recorder] Spawning JXA event monitor\n`);

    const monitorProc = spawn('osascript', ['-l', 'JavaScript', tmpScript, targetName || ''], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lineBuf = '';
    monitorProc.stdout.on('data', (chunk) => {
      lineBuf += chunk.toString('utf8');
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (!obj.__ready) emit(obj);
        } catch { /* ignore malformed */ }
      }
    });

    monitorProc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      process.stderr.write(`[JXA Monitor] ${msg}\n`);
      if (msg.includes('not allowed assistive') || msg.includes('1003') || msg.includes('AXError')) {
        emit({ __error: 'Accessibility permission denied.\nGo to System Settings → Privacy & Security → Accessibility\nand enable permission for Terminal / Electron / Prabala.' });
      }
    });

    monitorProc.on('error', (err) => {
      emit({ __error: `Failed to start JXA monitor: ${err.message}` });
    });

    const screenshotTimer = setInterval(captureScreenshot, SCREENSHOT_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(screenshotTimer);
      try { monitorProc.kill('SIGTERM'); } catch { /* ignore */ }
      try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('message', (msg) => { if (msg && msg.type === 'stop') cleanup(); });

    await new Promise(resolve => monitorProc.on('close', resolve));
    try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
    emit({ __done: true });
    process.exit(0);
    return;
  }

  // ── Windows: polling loop ────────────────────────────────────────────────────
  let errorsInRow = 0;
  let screenshotTick = 0;

  while (polling) {
    await new Promise(r => setTimeout(r, POLL_MS));
    if (stopping) break;

    try {
      const nodes = runPs(PS_DUMP, targetName || undefined);
      if (Array.isArray(nodes)) {
        const steps = diffWinNodes(nodes);
        for (const s of steps) emit(s);
      }
      errorsInRow = 0;
    } catch (err) {
      errorsInRow++;
      process.stderr.write(`[Desktop Recorder] poll error (${errorsInRow}): ${err.message}\n`);
      if (errorsInRow >= MAX_ERRORS) {
        emit({ __error: err.message });
        break;
      }
    }

    screenshotTick++;
    if (screenshotTick % Math.round(SCREENSHOT_INTERVAL_MS / POLL_MS) === 0) {
      await captureScreenshot();
    }
  }

  emit({ __done: true });
  process.exit(0);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
process.on('SIGTERM', () => { stopping = true; polling = false; });
process.on('SIGINT',  () => { stopping = true; polling = false; });
process.on('message', (msg) => { if (msg && msg.type === 'stop') { stopping = true; polling = false; } });

run().catch(err => {
  process.stderr.write('[Desktop Recorder] fatal: ' + String(err) + '\n');
  emit({ __error: err.message });
  emit({ __done: true });
  process.exit(1);
});

