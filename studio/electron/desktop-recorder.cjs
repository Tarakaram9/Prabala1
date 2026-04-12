// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Desktop Action Recorder  (no Appium, no Xcode required)
//
// Uses native OS accessibility APIs directly:
//   macOS   — osascript / JXA  (JavaScript for Automation, built into every Mac)
//   Windows — PowerShell + UIAutomationClient COM  (built into every Windows)
//
// Args:  <appPath>
//   appPath   Path to .app / .exe to launch, OR bundle ID / exe name to attach.
//             Pass empty string "" to attach to the frontmost/active window.
//
// Output (one JSON per line on stdout):
//   { "keyword": "Desktop.Click",     "params": { "locator": "name=Login" } }
//   { "keyword": "Desktop.EnterText", "params": { "locator": "name=Username", "value": "admin" } }
//   { "__screenshot": "<base64 png>", "__screenshotType": "png", "width": N, "height": N }
//   { "__axFallback": true, "message": "..." }   ← recording without element names
//   { "__done": true }
//   { "__error": "<message>" }
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { spawn, execSync, execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const net  = require('net');
const http = require('http');
const crypto = require('crypto');

const appArg = (process.argv[2] || '').trim();
const isMac  = process.platform === 'darwin';
const isWin  = process.platform === 'win32';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ── Screenshot ────────────────────────────────────────────────────────────────

let lastScreenshotHash = '';
const SCREENSHOT_INTERVAL_MS = 600;

// Non-blocking: runs screencapture/PowerShell asynchronously so the Node event
// loop is never stalled while waiting for the OS screenshot tool to finish.
let _screenshotInFlight = false;
function captureScreenshot() {
  if (_screenshotInFlight) return Promise.resolve();
  _screenshotInFlight = true;
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `prabala-screen-${Date.now()}.png`);
    let proc;
    if (isMac) {
      proc = spawn('screencapture', ['-x', '-t', 'png', tmp], { stdio: 'ignore' });
    } else if (isWin) {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $b=New-Object System.Drawing.Bitmap($bmp.Width,$bmp.Height); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $b.Save('${tmp.replace(/\\/g,'\\\\')}',[System.Drawing.Imaging.ImageFormat]::Png)`;
      proc = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    } else {
      _screenshotInFlight = false;
      return resolve();
    }
    proc.on('close', () => {
      _screenshotInFlight = false;
      try {
        if (!fs.existsSync(tmp)) return resolve();
        const data = fs.readFileSync(tmp).toString('base64');
        fs.unlinkSync(tmp);
        if (data === lastScreenshotHash) return resolve();
        lastScreenshotHash = data;
        emit({ __screenshot: data, __screenshotType: 'png', width: 1280, height: 800 });
      } catch { /* screenshot is best-effort */ }
      resolve();
    });
    proc.on('error', () => { _screenshotInFlight = false; resolve(); });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// macOS — JXA via osascript
// ═════════════════════════════════════════════════════════════════════════════

// JXA monitor script — key improvements over old version:
//  1. Probes AX permission at startup and emits __axFallback if denied
//  2. Falls back to position=x,y locators when AX is unavailable
//  3. Polls at 50 ms (was 150 ms) so clicks < 100 ms are reliably caught
//  4. Checks AX return codes on each call — switches to fallback if revoked mid-session
//  5. Text detection: only emits when value stabilises (debounce via prev/lastEmitted comparison)
//  6. Uses ObjC.unwrap() on NSPoint members to ensure plain JS numbers

const JXA_MONITOR = `
ObjC.import('AppKit');
ObjC.import('ApplicationServices');

// ── stdout helper ──────────────────────────────────────────────────────────
var stdout = $.NSFileHandle.fileHandleWithStandardOutput;
function emitLine(obj) {
  try {
    var data = $(JSON.stringify(obj) + '\\n').dataUsingEncoding($.NSUTF8StringEncoding);
    stdout.writeData(data);
  } catch(e) {}
}

// ── AX helpers ─────────────────────────────────────────────────────────────
var sysWide = $.AXUIElementCreateSystemWide();

// Probe AX permission.
//   kAXErrorAPIDisabled = -25211  → not trusted (accessibility denied)
//   kAXErrorNoValue     = -25300  → trusted but no focused element (normal)
//   0                             → trusted and element found
var _probeRef = Ref();
var _probeErr = $.AXUIElementCopyAttributeValue(sysWide, $('AXFocusedUIElement'), _probeRef);
var AX_AVAILABLE = (_probeErr !== -25211);

if (!AX_AVAILABLE) {
  emitLine({
    __axFallback: true,
    message: 'Accessibility permission not granted — recording in position mode (position=x,y locators).\\n' +
             'To get named element locators:\\n' +
             '  System Settings → Privacy & Security → Accessibility\\n' +
             '  Add osascript   (for dev mode)\\n' +
             '  OR add Prabala  (for packaged app)\\n' +
             'Then restart the desktop recorder.'
  });
}

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
var lastDown          = false;
var prevTextKey       = '';
var prevTextVal       = '';
var lastEmittedTxtVal = '';
// Pending text — accumulated while user types; emitted after TEXT_SETTLE ticks of no change.
var pendingTextLoc    = '';
var pendingTextVal    = '';
var textSettleTicks   = 0;
var TEXT_SETTLE       = 16;   // 16 × 50 ms = 800 ms stable before emitting
var screenH           = ObjC.unwrap($.NSScreen.mainScreen.frame).size.height;
var TEXT_ROLES        = ['AXTextField','AXTextArea','AXComboBox','AXSearchField','AXSecureTextField'];

emitLine({ __ready: true });

// ── main loop — 50 ms tick ──────────────────────────────────────────────────
while (true) {
  $.NSThread.sleepForTimeInterval(0.05);

  // ── click detection ────────────────────────────────────────────────────
  try {
    var buttons = $.NSEvent.pressedMouseButtons;
    var down    = (buttons & 1) === 1;

    if (down && !lastDown) {
      // Capture mouse position at the exact moment of button-down
      var mLoc   = $.NSEvent.mouseLocation;
      var clickX = mLoc.x;
      var clickY = screenH - mLoc.y;   // flip: NS bottom-left → AX top-left

      var emittedClick = false;

      if (AX_AVAILABLE) {
        var elRef  = Ref();
        var axErr  = $.AXUIElementCopyElementAtPosition(sysWide, clickX, clickY, elRef);

        if (axErr === 0) {
          emitLine({ keyword: 'Desktop.Click', params: { locator: locatorFor(elRef[0]) } });
          emittedClick = true;
        } else if (axErr === -25211) {
          // Permission revoked mid-session — switch to fallback
          AX_AVAILABLE = false;
          emitLine({
            __axFallback: true,
            message: 'Accessibility permission was revoked — switching to position mode.'
          });
        }
      }

      // Fallback: emit position locator (always useful for screenshots)
      if (!emittedClick) {
        emitLine({
          keyword: 'Desktop.Click',
          params: { locator: 'position=' + Math.round(clickX) + ',' + Math.round(clickY) }
        });
      }
    }

    lastDown = down;
  } catch(e) {}

  // ── text-field value change detection (AX only) ────────────────────────
  if (AX_AVAILABLE) {
    try {
      var focRef = Ref();
      if ($.AXUIElementCopyAttributeValue(sysWide, $('AXFocusedUIElement'), focRef) === 0) {
        var focEl  = focRef[0];
        var role   = axAttr(focEl, 'AXRole');

        if (TEXT_ROLES.indexOf(role) >= 0) {
          var ftitle = axAttr(focEl, 'AXTitle') || axAttr(focEl, 'AXDescription') || '';
          var curVal = axAttr(focEl, 'AXValue') || '';
          var key    = role + ':' + ftitle;

          if (key !== prevTextKey) {
            // Focus moved away — flush any pending text for the old field
            if (pendingTextVal && pendingTextVal !== lastEmittedTxtVal) {
              emitLine({ keyword: 'Desktop.EnterText', params: { locator: pendingTextLoc, value: pendingTextVal } });
              lastEmittedTxtVal = pendingTextVal;
            }
            prevTextKey       = key;
            prevTextVal       = curVal;
            lastEmittedTxtVal = curVal;
            pendingTextLoc    = '';
            pendingTextVal    = '';
            textSettleTicks   = 0;
          } else if (curVal !== prevTextVal) {
            // Value changed — accumulate, reset settle counter
            prevTextVal = curVal;
            if (curVal) {
              pendingTextLoc  = ftitle ? 'name=' + ftitle.trim() : 'role=' + role;
              pendingTextVal  = curVal;
              textSettleTicks = 0;
            }
          } else if (pendingTextVal) {
            // Value stable — count up towards emit
            textSettleTicks++;
            if (textSettleTicks >= TEXT_SETTLE && pendingTextVal !== lastEmittedTxtVal) {
              emitLine({ keyword: 'Desktop.EnterText', params: { locator: pendingTextLoc, value: pendingTextVal } });
              lastEmittedTxtVal = pendingTextVal;
              pendingTextVal    = '';
              textSettleTicks   = 0;
            }
          }
        }
      }
    } catch(e) {}
  }
}
`.trim();

// ── macOS: launch app ─────────────────────────────────────────────────────────

function macLaunchApp(appPath) {
  if (appPath.endsWith('.app')) {
    const args = path.isAbsolute(appPath) ? [appPath] : ['-a', appPath];
    execFileSync('open', args, { stdio: 'ignore' });
    for (let i = 0; i < 6; i++) execSync('sleep 0.5');
    return path.basename(appPath, '.app');
  }
  execFileSync('open', ['-a', appPath], { stdio: 'ignore' });
  for (let i = 0; i < 6; i++) execSync('sleep 0.5');
  return appPath;
}

// ═════════════════════════════════════════════════════════════════════════════
// Windows — PowerShell UIAutomation
// ═════════════════════════════════════════════════════════════════════════════

function buildPsDump(targetName) {
  const safe = (targetName || '').replace(/'/g, "''");
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ae   = [System.Windows.Automation.AutomationElement]
$root = $ae::RootElement
$targetName = '${safe}'

function Flatten($el, $depth) {
  if ($depth -gt 6) { return }
  $props = $el.GetCurrentPropertyValue($ae::NameProperty)
  $role  = $el.GetCurrentPropertyValue($ae::ControlTypeProperty).ProgrammaticName
  $aid   = $el.GetCurrentPropertyValue($ae::AutomationIdProperty)
  $val   = ''
  try {
    $vp   = [System.Windows.Automation.ValuePattern]
    $vobj = $el.GetCurrentPattern($vp::Pattern)
    $val  = $vobj.Current.Value
  } catch {}
  $focused = $el.GetCurrentPropertyValue($ae::HasKeyboardFocusProperty)
  [PSCustomObject]@{ role=$role; name=$props; val=$val; id=$aid; focused=$focused }
  $cond     = [System.Windows.Automation.Condition]::TrueCondition
  $children = $el.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  foreach ($c in $children) { Flatten $c ($depth+1) }
}

if ($targetName) {
  $win = $null
  try {
    $pids = @(Get-Process | Where-Object { $_.Name -like "*$targetName*" } | Select-Object -ExpandProperty Id)
    if ($pids.Count -gt 0) {
      $allWins = $root.FindAll([System.Windows.Automation.TreeScope]::Children,
                               [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($w in $allWins) {
        $wPid = [int]$w.GetCurrentPropertyValue($ae::ProcessIdProperty)
        if ($pids -contains $wPid) { $win = $w; break }
      }
    }
  } catch {}
  if (-not $win) {
    $titleCond = New-Object System.Windows.Automation.PropertyCondition($ae::NameProperty, $targetName)
    $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $titleCond)
  }
  if (-not $win) { Write-Output '[]'; exit }
  @(Flatten $win 0) | ConvertTo-Json -Compress
} else {
  $fw = [System.Windows.Automation.AutomationElement]::FocusedElement
  if (-not $fw) { Write-Output '[]'; exit }
  $proc = $fw
  while ($proc -and $proc.CachedParent -and $proc.CachedParent -ne $root) {
    $proc = $proc.CachedParent
  }
  if (-not $proc) { Write-Output '[]'; exit }
  @(Flatten $proc 0) | ConvertTo-Json -Compress
}`.trim();
}

// ── Persistent PowerShell host ───────────────────────────────────────────────
// A single PS process stays alive for the lifetime of the recorder.
// Each poll sends the dump script delimited by __PRABALA_END__ so we never
// pay the ~500-2000 ms process-startup cost on every tick.
let _psProc = null;
let _psRxBuf = '';
let _psPendingResolve = null;

function getPsProc() {
  if (_psProc && !_psProc.killed) return _psProc;
  _psProc = spawn('powershell', ['-NoProfile', '-NoExit', '-Command', '-'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  _psRxBuf = '';
  _psProc.stdout.on('data', (chunk) => {
    _psRxBuf += chunk.toString('utf8');
    const idx = _psRxBuf.indexOf('__PRABALA_END__');
    if (idx !== -1 && _psPendingResolve) {
      const jsonPart = _psRxBuf.slice(0, idx).trim();
      _psRxBuf = _psRxBuf.slice(idx + '__PRABALA_END__'.length);
      const resolve = _psPendingResolve;
      _psPendingResolve = null;
      try { resolve(JSON.parse(jsonPart || '[]')); } catch { resolve([]); }
    }
  });
  _psProc.on('close', () => { _psProc = null; if (_psPendingResolve) { _psPendingResolve([]); _psPendingResolve = null; } });
  _psProc.on('error', () => { if (_psPendingResolve) { _psPendingResolve([]); _psPendingResolve = null; } });
  return _psProc;
}

function runPs(script) {
  return new Promise((resolve) => {
    if (_psPendingResolve) { resolve([]); return; } // previous poll still running
    _psPendingResolve = resolve;
    const ps = getPsProc();
    // Wrap script so we can detect the response boundary
    ps.stdin.write(`${script}\nWrite-Output '__PRABALA_END__'\n`);
    // Safety timeout — resolve with empty array if PS hangs
    setTimeout(() => {
      if (_psPendingResolve === resolve) { _psPendingResolve = null; resolve([]); }
    }, 3000);
  });
}

function stopPsProc() {
  if (_psProc && !_psProc.killed) {
    try { _psProc.stdin.end(); _psProc.kill(); } catch { /* ignore */ }
  }
  _psProc = null;
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

/** Fast TCP probe — checks if a port is open without doing any HTTP.
 *  Returns true within ~200 ms if open, false immediately on ECONNREFUSED. */
function isPortOpen(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    sock.setTimeout(200);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error',   () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

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

/** Send one CDP command over a WebSocket. */
function cdpSend(_sock, send, id, method, params) {
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
        frames.push(buf.subarray(off, off + plen).toString('utf8'));
        buf = buf.subarray(off + plen);
      }
      return { frames, remaining: buf };
    }

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

  document.addEventListener('click', function(e) {
    var el = e.target;
    window.__prabalaEvent(JSON.stringify({ type:'click', locator: bestLocator(el) }));
  }, true);

  var inputTimers = new WeakMap();
  document.addEventListener('input', function(e) {
    var el = e.target;
    if (!['INPUT','TEXTAREA'].includes(el.tagName)) return;
    if (inputTimers.has(el)) clearTimeout(inputTimers.get(el));
    inputTimers.set(el, setTimeout(function() {
      window.__prabalaEvent(JSON.stringify({ type:'input', locator: bestLocator(el), value: el.value }));
    }, 600));
  }, true);

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
          if (hEnd !== -1) rxBuf = data.subarray(hEnd + 4);
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

        if (msg.id === 1 && msg.result !== undefined) {
          cdpSend(sock, send, cmdId++, 'Runtime.evaluate', {
            expression: INJECT, returnByValue: true
          });
        }

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

const POLL_MS    = 200;
const MAX_ERRORS = 8;
let polling  = true;
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

  // ── macOS: fast port probe → CDP (Electron apps) or JXA ──────────────────
  if (isMac) {
    // Fast TCP probe first — if port 9222 isn't even open skip CDP immediately
    const portOpen = await isPortOpen(9222);
    let cdpWsUrl = null;
    if (portOpen) {
      process.stderr.write(`[Desktop Recorder] Port 9222 open — probing for CDP\n`);
      cdpWsUrl = await detectCdp(9222, 1500);
    }

    if (cdpWsUrl) {
      process.stderr.write(`[Desktop Recorder] Electron app detected — using CDP recorder\n`);
      await runCdpRecorder(cdpWsUrl);
      return;
    }

    // ── JXA AX monitor ────────────────────────────────────────────────────────
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
          // Forward everything except the internal __ready handshake
          if (!obj.__ready) emit(obj);
        } catch { /* ignore malformed */ }
      }
    });

    monitorProc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (!msg) return;
      process.stderr.write(`[JXA Monitor] ${msg}\n`);
      // Catch explicit AX/osascript error strings that land on stderr
      if (
        msg.includes('not allowed assistive') ||
        msg.includes('1003') ||
        msg.includes('AXError') ||
        msg.includes('kAXError')
      ) {
        emit({
          __error:
            'Accessibility permission denied.\n' +
            'To enable desktop recording:\n' +
            '  System Settings → Privacy & Security → Accessibility\n' +
            '  Click + and add:\n' +
            '    • osascript  (dev mode — /usr/bin/osascript)\n' +
            '    • Prabala    (packaged app)\n' +
            'Then restart the desktop recorder.'
        });
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

    await new Promise(resolve => monitorProc.once('close', resolve));
    try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
    emit({ __done: true });
    process.exit(0);
  }

  // ── Windows: polling loop (persistent PS process) ────────────────────────
  // Pre-warm the PowerShell host before the first poll to hide startup latency.
  getPsProc();

  let errorsInRow  = 0;
  let screenshotTick = 0;

  while (polling) {
    await new Promise(r => setTimeout(r, POLL_MS));
    if (stopping) break;

    try {
      const nodes = await runPs(buildPsDump(targetName));
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

  stopPsProc();
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
