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

const startUrl = process.argv[2] || '';

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
  const browser = await playwright.chromium.launch({
    headless: false,
    args: [
      '--window-size=1280,820',
      '--window-position=80,80',
      '--disable-infobars',
    ],
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

  // Signal done when browser is closed by user
  browser.on('disconnected', () => {
    emit({ __done: true });
    process.exit(0);
  });

  // Allow parent to send SIGTERM to stop recording
  process.on('SIGTERM', () => {
    browser.close().catch(() => {}).finally(() => {
      emit({ __done: true });
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    browser.close().catch(() => {}).finally(() => {
      emit({ __done: true });
      process.exit(0);
    });
  });
}

run().catch((err) => {
  process.stderr.write('[Recorder] fatal: ' + String(err) + '\n');
  process.exit(1);
});
