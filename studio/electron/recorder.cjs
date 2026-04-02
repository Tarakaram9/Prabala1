// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Browser Action Recorder
// Spawned as a child process by the Electron main process.
// Launches a visible Chromium window, intercepts user actions, and emits each
// action as a JSON line to stdout so the main process can forward it to the
// renderer as an incremental test step.
//
// Output format (one JSON per line):
//   { "keyword": "Click",     "params": { "locator": "...", ... } }
//   { "keyword": "EnterText", "params": { "locator": "...", "value": "..." } }
//   { "__done": true }  ← browser window closed
// ─────────────────────────────────────────────────────────────────────────────

const playwright = require('playwright');
const os = require('os');

const startUrl = process.argv[2] || '';
const isWin = os.platform() === 'win32';

// Detect headless container: explicit env, or Linux without a DISPLAY
const forceHeadless = process.env.PRABALA_HEADLESS === '1' ||
  (os.platform() === 'linux' && !process.env.DISPLAY);

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ── Locator strategy ──────────────────────────────────────────────────────────
// Injected into each page. Produces Prabala-style locators from DOM elements.
const LOCATOR_SCRIPT = /* js */ `
window.__prabalaGetLocator = function(el) {
  if (!el) return 'unknown';
  // 1. id
  if (el.id && !el.id.match(/^\\d/)) return '#' + el.id;
  // 2. data-testid / data-cy / aria-label
  const testid = el.getAttribute('data-testid') || el.getAttribute('data-cy');
  if (testid) return '[data-testid="' + testid + '"]';
  const aria = el.getAttribute('aria-label');
  if (aria) return '[aria-label="' + aria + '"]';
  // 3. placeholder for inputs
  const ph = el.getAttribute('placeholder');
  if (ph) return '[placeholder="' + ph + '"]';
  // 4. visible text for clickable non-input elements
  const tag = el.tagName.toLowerCase();
  if (!['input','textarea','select'].includes(tag)) {
    const txt = (el.innerText || el.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 50);
    if (txt) return 'text=' + txt;
  }
  // 5. CSS fallback
  const cls = [...el.classList].filter(c => !/\\d{3,}/.test(c)).slice(0, 2).join('.');
  return tag + (cls ? '.' + cls : '');
};
`;

const INTERCEPT_SCRIPT = /* js */ `
(function() {
  // Avoid double-binding on hot reloads
  if (window.__prabalaRecorderActive) return;
  window.__prabalaRecorderActive = true;

  // Track last input to debounce rapid keystrokes
  let inputTimer = null;
  let lastInputEl = null;
  let lastInputVal = '';

  // --- CLICK ---
  document.addEventListener('click', function(e) {
    const el = e.target;
    if (['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) return;
    if (el.tagName === 'OPTION') return;
    const loc = window.__prabalaGetLocator(el);
    window.__prabalaSendStep('click', loc, '');
  }, true);

  // --- INPUT (debounced) ---
  document.addEventListener('input', function(e) {
    const el = e.target;
    if (!['INPUT','TEXTAREA'].includes(el.tagName)) return;
    lastInputEl = el;
    lastInputVal = el.value;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(function() {
      if (!lastInputEl) return;
      const loc = window.__prabalaGetLocator(lastInputEl);
      window.__prabalaSendStep('input', loc, lastInputVal);
    }, 600);
  }, true);

  // --- SELECT ---
  document.addEventListener('change', function(e) {
    const el = e.target;
    if (el.tagName !== 'SELECT') return;
    const loc = window.__prabalaGetLocator(el);
    window.__prabalaSendStep('select', loc, el.value);
  }, true);

  // --- KEY (Enter / Escape / Tab) ---
  document.addEventListener('keydown', function(e) {
    if (['Enter','Escape','Tab'].includes(e.key)) {
      // Flush pending input first
      if (lastInputEl && inputTimer) {
        clearTimeout(inputTimer);
        const loc = window.__prabalaGetLocator(lastInputEl);
        window.__prabalaSendStep('input', loc, lastInputVal);
        lastInputEl = null;
      }
      if (e.key === 'Enter') {
        window.__prabalaSendStep('key', 'Enter', '');
      }
    }
  }, true);
})();
`;

async function run() {
  const launchArgs = [
    '--window-size=1280,820',
    '--window-position=80,80',
    '--disable-infobars',
  ];
  // Containers / CI: add --no-sandbox on Linux (required when running in Docker,
  // even as a non-root user, because user namespaces are typically disabled)
  if (os.platform() === 'linux') {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage');
  }

  const browser = await playwright.chromium.launch({
    headless: forceHeadless,
    args: launchArgs,
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  // Track navigation
  let lastNavUrl = '';
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (!url.startsWith('http') || url === lastNavUrl) return;
    lastNavUrl = url;
    emit({ keyword: 'NavigateTo', params: { url } });
  });

  // Inject locator helper + event listeners into every new page/frame
  await context.addInitScript(LOCATOR_SCRIPT + '\n' + INTERCEPT_SCRIPT);

  // Expose bridge function from page JS → main process stdout
  await context.exposeFunction('__prabalaSendStep', (type, locator, value) => {
    switch (type) {
      case 'click':
        emit({ keyword: 'Click', params: { locator } });
        break;
      case 'input':
        if (value !== '') {
          emit({ keyword: 'EnterText', params: { locator, value } });
        }
        break;
      case 'select':
        emit({ keyword: 'SelectOption', params: { locator, option: value } });
        break;
      case 'key':
        emit({ keyword: 'PressKey', params: { key: locator } });
        break;
    }
  });

  // Navigate to start URL if provided
  if (startUrl && startUrl !== 'about:blank') {
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      process.stderr.write('[Recorder] navigate error: ' + String(e) + '\n');
    }
  }

  // ── Docker / headless mode: stream screenshots + accept pointer/keyboard commands ──────
  // When running in a container the user can't see the browser window directly.
  // We stream JPEG snapshots via stdout so the Studio UI can show a live preview,
  // and we accept JSON commands on stdin so the user can interact with the page.
  if (forceHeadless) {
    // Screenshot stream
    const screenshotInterval = setInterval(async () => {
      try {
        if (page.isClosed()) return;
        const buf = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 55, timeout: 3000 });
        emit({ __screenshot: buf.toString('base64'), width: 1280, height: 820 });
      } catch { /* page may be navigating */ }
    }, 300);

    // Stop the interval when the browser closes
    browser.on('disconnected', () => clearInterval(screenshotInterval));

    // Stdin interaction commands
    let stdinBuf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      stdinBuf += chunk;
      const lines = stdinBuf.split('\n');
      stdinBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const cmd = JSON.parse(line);
          if (cmd.cmd === 'click')  page.mouse.click(cmd.x, cmd.y).catch(() => {});
          if (cmd.cmd === 'dblclick') page.mouse.dblclick(cmd.x, cmd.y).catch(() => {});
          if (cmd.cmd === 'type')   page.keyboard.type(cmd.text, { delay: 30 }).catch(() => {});
          if (cmd.cmd === 'key')    page.keyboard.press(cmd.key).catch(() => {});
          if (cmd.cmd === 'scroll') page.mouse.wheel(cmd.dx ?? 0, cmd.dy ?? 0).catch(() => {});
        } catch { /* malformed command */ }
      }
    });
  }

  // Signal done when browser is closed by user
  browser.on('disconnected', () => {
    emit({ __done: true });
    process.exit(0);
  });

  function gracefulShutdown() {
    browser.close().catch(() => {}).finally(() => {
      emit({ __done: true });
      process.exit(0);
    });
  }

  // Unix: SIGTERM / SIGINT
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Windows: parent sends { type: 'stop' } via IPC because SIGTERM is unreliable
  if (isWin) {
    process.on('message', (msg) => {
      if (msg && msg.type === 'stop') gracefulShutdown();
    });
  }
}

run().catch((err) => {
  process.stderr.write('[Recorder] fatal: ' + String(err) + '\n');
  process.exit(1);
});
