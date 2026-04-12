// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Native Desktop Element Spy (no Appium required)
//
// Uses native OS accessibility APIs to identify the element under the cursor
// in real-time, then captures its locator when the user clicks.
//
//   macOS   — Swift + ApplicationServices AX API  (ships with every Mac)
//   Windows — PowerShell + UIAutomation COM (built into every Windows)
//
// NOTE: JXA (osascript -l JavaScript) was used previously but its ObjC bridge
// does NOT properly write back CFTypeRef* output params from C AX functions —
// `Ref()[0]` stays as a JS function object, so all axAttr() calls return ''.
// Swift handles &value inout params correctly, so we use `swift script.swift`.
//
// stdout events:
//   { "__hover": true, "locator": "...", "tag": "...", "text": "..." }
//       Emitted continuously as user moves mouse (live preview)
//   { "locator": "...", "tag": "...", "text": "..." }
//       Emitted once when user left-clicks — final capture
//   { "__done": true }
//   { "__error": "..." }
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// macOS — Swift/AX spy
// ═════════════════════════════════════════════════════════════════════════════
// Written to a temp .swift file and run with `swift <file>`.
// Swift correctly bridges AXUIElement C functions (AXUIElementCopyAttributeValue
// etc.) using & inout params, unlike JXA's Ref() which fails for CFTypeRef*.

const SWIFT_SPY = `
import Foundation
import AppKit
import ApplicationServices

// ── JSON emit ────────────────────────────────────────────────────────────────
let stdoutFH = FileHandle.standardOutput
func emitLine(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return }
    stdoutFH.write(data)
    stdoutFH.write(Data([0x0a])) // newline
}

// ── AX helpers ───────────────────────────────────────────────────────────────
func axAttr(_ el: AXUIElement, _ attr: String) -> String {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(el, attr as CFString, &value)
    guard err == .success, let v = value else { return "" }
    if let s = v as? String { return s }
    // Numeric value (e.g. AXValue for sliders) — convert to string
    if let n = v as? NSNumber { return n.stringValue }
    return ""
}

func locatorFor(_ el: AXUIElement) -> String {
    let id = axAttr(el, "AXIdentifier")
    if !id.isEmpty && id.count < 80 { return "id=\\(id)" }
    let t1 = axAttr(el, "AXTitle")
    let t2 = axAttr(el, "AXDescription")
    let title = t1.isEmpty ? t2 : t1
    if !title.isEmpty && title.count < 80 { return "name=\\(title)" }
    let val = axAttr(el, "AXValue")
    if !val.isEmpty && val.count < 60 { return "value=\\(val)" }
    let role = axAttr(el, "AXRole")
    if role.isEmpty { return "role=Element" }
    return "role=\\(role)"
}

// ── Signal handling (clean exit on SIGTERM/SIGINT from parent process) ───────
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT)  { _ in exit(0) }

// ── Check AX permission ──────────────────────────────────────────────────────
let sysWide = AXUIElementCreateSystemWide()
var probeVal: CFTypeRef?
let probeErr = AXUIElementCopyAttributeValue(sysWide, "AXFocusedUIElement" as CFString, &probeVal)
if probeErr == .apiDisabled {
    emitLine(["__error": "Accessibility permission not granted.\\nSystem Settings → Privacy & Security → Accessibility\\nAdd the app that launched this spy, then restart."])
    exit(1)
}

// ── State ────────────────────────────────────────────────────────────────────
var lastLocator = ""
var lastDown    = false
let screenH     = NSScreen.main?.frame.height ?? 768.0

// ── Main poll loop (100 ms) ───────────────────────────────────────────────────
while true {
    Thread.sleep(forTimeInterval: 0.1)

    let mouseLoc = NSEvent.mouseLocation
    let mx = Float(mouseLoc.x)
    let my = Float(screenH - mouseLoc.y)   // flip: NS bottom-left → AX top-left

    var elementRef: AXUIElement?
    let axErr = AXUIElementCopyElementAtPosition(sysWide, mx, my, &elementRef)

    if axErr == .apiDisabled {
        emitLine(["__error": "Accessibility permission was revoked."])
        break
    }

    var locator = ""
    var tag     = ""
    var text    = ""

    if axErr == .success, let el = elementRef {
        locator = locatorFor(el)
        tag     = axAttr(el, "AXRole")
        let v   = axAttr(el, "AXValue")
        let t   = axAttr(el, "AXTitle")
        text    = v.isEmpty ? t : v
    } else {
        locator = "position=\\(Int(mx)),\\(Int(my))"
    }

    if locator != lastLocator {
        emitLine(["__hover": true, "locator": locator, "tag": tag, "text": text])
        lastLocator = locator
    }

    // Detect left-click → capture + exit
    let buttons = NSEvent.pressedMouseButtons
    let down    = (buttons & 1) == 1
    if down && !lastDown {
        emitLine(["locator": locator, "tag": tag, "text": text])
        emitLine(["__done": true])
        break
    }
    lastDown = down
}
`.trim();

// ═════════════════════════════════════════════════════════════════════════════
// Windows — PowerShell UIAutomation spy
// ═════════════════════════════════════════════════════════════════════════════
// Uses UIAutomationClient to get the element at the current mouse position.
// Polls at 150 ms. On left-click: emits final capture + exits.

const PS_SPY = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$ae = [System.Windows.Automation.AutomationElement]

function GetLocator($el) {
  try {
    $id   = $el.GetCurrentPropertyValue($ae::AutomationIdProperty)
    $name = $el.GetCurrentPropertyValue($ae::NameProperty)
    $role = $el.GetCurrentPropertyValue($ae::ControlTypeProperty).ProgrammaticName
    if ($id   -and $id.Trim())   { return "id=$($id.Trim())" }
    if ($name -and $name.Trim()) { return "name=$($name.Trim())" }
    return "role=$role"
  } catch { return 'role=Element' }
}

$lastDown    = $false
$lastLocator = ''

while ($true) {
  Start-Sleep -Milliseconds 150

  $pt = [System.Windows.Forms.Control]::MousePosition
  $wpPt = [System.Windows.Point]::new($pt.X, $pt.Y)

  $locator = ''
  $tag     = ''
  $text    = ''

  try {
    $el      = $ae::FromPoint($wpPt)
    if ($el) {
      $locator = GetLocator $el
      $tag     = $el.GetCurrentPropertyValue($ae::ControlTypeProperty).ProgrammaticName
      $name    = $el.GetCurrentPropertyValue($ae::NameProperty)
      $text    = if ($name) { $name } else { '' }
    }
  } catch {}

  if (-not $locator) { $locator = "position=$($pt.X),$($pt.Y)" }

  if ($locator -ne $lastLocator) {
    $safe_loc  = $locator -replace '"','\"'
    $safe_tag  = $tag     -replace '"','\"'
    $safe_text = $text    -replace '"','\"'
    Write-Output ('{"__hover":true,"locator":"' + $safe_loc + '","tag":"' + $safe_tag + '","text":"' + $safe_text + '"}')
    $lastLocator = $locator
  }

  # Detect left-click → capture + exit
  $down = [System.Windows.Forms.Control]::MouseButtons -band [System.Windows.Forms.MouseButtons]::Left
  if ($down -and -not $lastDown) {
    $safe_loc  = $locator -replace '"','\"'
    $safe_tag  = $tag     -replace '"','\"'
    $safe_text = $text    -replace '"','\"'
    Write-Output ('{"locator":"' + $safe_loc + '","tag":"' + $safe_tag + '","text":"' + $safe_text + '"}')
    Write-Output '{"__done":true}'
    break
  }
  $lastDown = [bool]$down
}
`.trim();

// ═════════════════════════════════════════════════════════════════════════════
// Runner
// ═════════════════════════════════════════════════════════════════════════════

async function run() {
  if (!isMac && !isWin) {
    emit({ __error: 'Native desktop spy is only supported on macOS and Windows.' });
    emit({ __done: true });
    return;
  }

  if (isMac) {
    // Write the Swift source to a temp file, compile to a cached binary, then
    // run the binary. Compilation happens once — the binary is cached at a
    // stable path keyed by a hash of the script content so recompile only
    // happens when the script changes.
    const tmpDir     = os.tmpdir();
    const scriptHash = require('crypto').createHash('sha1').update(SWIFT_SPY).digest('hex').slice(0, 8);
    const srcFile    = path.join(tmpDir, `prabala-spy-${scriptHash}.swift`);
    const binFile    = path.join(tmpDir, `prabala-spy-${scriptHash}`);

    // Write source (idempotent — only if not already there)
    if (!fs.existsSync(srcFile)) fs.writeFileSync(srcFile, SWIFT_SPY, 'utf8');

    // Compile if binary not cached
    if (!fs.existsSync(binFile)) {
      const { status, stderr } = require('child_process').spawnSync(
        '/usr/bin/swiftc',
        [srcFile, '-o', binFile, '-framework', 'AppKit', '-framework', 'ApplicationServices'],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      );
      if (status !== 0) {
        emit({ __error: `Swift compile failed: ${stderr?.toString().trim() || 'unknown error'}` });
        emit({ __done: true });
        return;
      }
    }

    const proc = spawn(binFile, [], { stdio: ['ignore', 'pipe', 'pipe'] });

    let lineBuf = '';
    proc.stdout.on('data', (chunk) => {
      lineBuf += chunk.toString('utf8');
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          process.stdout.write(JSON.stringify(obj) + '\n');
        } catch { /* ignore malformed */ }
      }
    });

    proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) process.stderr.write(`[DesktopSpy] ${msg}\n`);
    });

    proc.on('error', (err) => {
      emit({ __error: `Failed to run spy: ${err.message}` });
    });

    const cleanup = () => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT',  cleanup);
    process.on('message', (msg) => { if (msg && msg.type === 'stop') cleanup(); });

    await new Promise(resolve => proc.once('close', resolve));
    emit({ __done: true });
    process.exit(0);
    return;
  }

  // Windows — PowerShell
  const tmpScript = path.join(os.tmpdir(), `prabala-spy-${Date.now()}.ps1`);
  fs.writeFileSync(tmpScript, PS_SPY, 'utf8');

  const proc = spawn('powershell', ['-NoProfile', '-File', tmpScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let lineBuf = '';
  proc.stdout.on('data', (chunk) => {
    lineBuf += chunk.toString('utf8');
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        process.stdout.write(JSON.stringify(obj) + '\n');
      } catch { /* ignore malformed */ }
    }
  });

  proc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) process.stderr.write(`[DesktopSpy] ${msg}\n`);
  });

  proc.on('error', (err) => {
    emit({ __error: `Failed to start native spy: ${err.message}` });
  });

  const cleanup = () => {
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT',  cleanup);
  process.on('message', (msg) => { if (msg && msg.type === 'stop') cleanup(); });

  await new Promise(resolve => proc.once('close', resolve));
  try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
  emit({ __done: true });
  process.exit(0);
}

run().catch(err => {
  emit({ __error: err.message });
  emit({ __done: true });
  process.exit(1);
});
