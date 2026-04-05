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

  let errorsInRow = 0;
  let screenshotTick = 0;

  while (polling) {
    await new Promise(r => setTimeout(r, POLL_MS));
    if (stopping) break;

    try {
      let steps = [];
      if (isMac) {
        const nodes = runJxa(JXA_AX, targetName || undefined);
        if (Array.isArray(nodes)) steps = diffMacNodes(nodes);
      } else {
        const nodes = runPs(PS_DUMP, targetName || undefined);
        if (Array.isArray(nodes)) steps = diffWinNodes(nodes);
      }
      for (const s of steps) emit(s);
      errorsInRow = 0;
    } catch (err) {
      errorsInRow++;
      process.stderr.write(`[Desktop Recorder] poll error (${errorsInRow}): ${err.message}\n`);
      if (errorsInRow >= MAX_ERRORS) {
        let msg = err.message;
        if (isMac && msg.includes('not allowed assistive')) {
          msg = 'Accessibility permission denied.\nGo to System Settings → Privacy & Security → Accessibility\nand enable permission for Terminal / Electron / Prabala.';
        }
        emit({ __error: msg });
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

