import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Search, Globe, Monitor, Zap, Box, MousePointer, CheckSquare, Camera } from 'lucide-react'

const KW_DETAILS: Record<string, { desc: string; params: string[]; example?: string }> = {
  'Web.Launch':       { desc: 'Open a new Chromium/Firefox/WebKit browser session', params: [] },
  'Web.Close':        { desc: 'Close the browser and save Playwright trace', params: [] },
  'NavigateTo':       { desc: 'Navigate to a URL', params: ['url'], example: 'url: "{BASE_URL}/login"' },
  'GoBack':           { desc: 'Navigate the browser back', params: [] },
  'Reload':           { desc: 'Reload the current page', params: [] },
  'Click':            { desc: 'Click a web element', params: ['locator'], example: 'locator: "@login-button"' },
  'DoubleClick':      { desc: 'Double-click a web element', params: ['locator'] },
  'RightClick':       { desc: 'Right-click a web element', params: ['locator'] },
  'EnterText':        { desc: 'Clear and fill a text input', params: ['locator', 'value'], example: 'locator: "@username", value: "{TEST_DATA.user}"' },
  'PressKey':         { desc: 'Press a keyboard key: Enter, Tab, Escape, etc.', params: ['key'], example: 'key: "Enter"' },
  'SelectOption':     { desc: 'Select a dropdown option by label or value', params: ['locator', 'option'] },
  'Hover':            { desc: 'Hover the mouse over an element', params: ['locator'] },
  'ScrollTo':         { desc: 'Scroll an element into the viewport', params: ['locator'] },
  'Check':            { desc: 'Check a checkbox', params: ['locator'] },
  'Uncheck':          { desc: 'Uncheck a checkbox', params: ['locator'] },
  'UploadFile':       { desc: 'Upload a file via a file input', params: ['locator', 'filePath'] },
  'WaitForVisible':   { desc: 'Wait until an element becomes visible', params: ['locator'] },
  'WaitForHidden':    { desc: 'Wait until an element is hidden/removed', params: ['locator'] },
  'WaitForNavigation':{ desc: 'Wait for the page to reach networkidle state', params: [] },
  'Wait':             { desc: 'Pause for a fixed number of milliseconds', params: ['ms'], example: 'ms: 2000' },
  'AssertVisible':    { desc: 'Fail if element is not visible', params: ['locator'] },
  'AssertNotVisible': { desc: 'Fail if element IS visible', params: ['locator'] },
  'AssertText':       { desc: 'Fail if element text does not contain expected', params: ['locator', 'expected'] },
  'AssertTitle':      { desc: 'Fail if page title does not contain expected', params: ['expected'] },
  'AssertUrl':        { desc: 'Fail if current URL does not contain expected', params: ['expected'] },
  'AssertEnabled':    { desc: 'Fail if element is not enabled', params: ['locator'] },
  'AssertValue':      { desc: 'Fail if input value does not match expected', params: ['locator', 'expected'] },
  'GetText':          { desc: 'Save element inner text to a variable', params: ['locator', 'variable'] },
  'GetValue':         { desc: 'Save input value to a variable', params: ['locator', 'variable'] },
  'TakeScreenshot':   { desc: 'Capture a full-page PNG screenshot to artifacts/', params: ['name'] },
  'AcceptAlert':      { desc: 'Accept the next browser dialog/alert', params: [] },
  'DismissAlert':     { desc: 'Dismiss the next browser dialog/alert', params: [] },
  'SwitchToFrame':    { desc: 'Switch context into an iframe by name', params: ['name'] },
  'API.GET':          { desc: 'HTTP GET request; stores response in a variable', params: ['url', 'responseAs'] },
  'API.POST':         { desc: 'HTTP POST request with JSON body', params: ['url', 'body', 'responseAs'] },
  'API.AssertStatus': { desc: 'Assert the last HTTP status code', params: ['expected'], example: 'expected: 200' },
  'API.AssertBody':   { desc: 'Assert a JSON path value in the last response', params: ['path', 'expected'] },
  'Desktop.LaunchApp':    { desc: 'Launch a desktop application (Phase 2)', params: ['appPath', 'platform'] },
  'Desktop.Click':        { desc: 'Click a desktop UI element (Phase 2)', params: ['locator'] },
  'Desktop.EnterText':    { desc: 'Type into a desktop input (Phase 2)', params: ['locator', 'value'] },
  'Desktop.AssertVisible':{ desc: 'Assert a desktop element is visible (Phase 2)', params: ['locator'] },
  'Desktop.CloseApp':     { desc: 'Close the desktop application (Phase 2)', params: [] },
}

const tagColor: Record<string, string> = {
  'Web': 'bg-blue-900/40 text-blue-400 border-blue-800/50',
  'Navigation': 'bg-indigo-900/40 text-indigo-400 border-indigo-800/50',
  'Interaction': 'bg-brand-900/40 text-brand-400 border-brand-800/50',
  'Wait': 'bg-purple-900/40 text-purple-400 border-purple-800/50',
  'Assert': 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50',
  'Capture': 'bg-pink-900/40 text-pink-400 border-pink-800/50',
  'API': 'bg-green-900/40 text-green-400 border-green-800/50',
  'Desktop': 'bg-orange-900/40 text-orange-400 border-orange-800/50',
}

function getTag(kw: string): string {
  if (kw.startsWith('Web.')) return 'Web'
  if (kw === 'NavigateTo' || kw === 'GoBack' || kw === 'Reload') return 'Navigation'
  if (kw.startsWith('Wait')) return 'Wait'
  if (kw.startsWith('Assert')) return 'Assert'
  if (kw === 'GetText' || kw === 'GetValue' || kw === 'TakeScreenshot') return 'Capture'
  if (kw.startsWith('API.')) return 'API'
  if (kw.startsWith('Desktop.')) return 'Desktop'
  return 'Interaction'
}

export default function KeywordLibraryPage() {
  const keywords = useAppStore(s => s.keywords)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>('NavigateTo')
  const [filterTag, setFilterTag] = useState<string | null>(null)

  const allTags = Array.from(new Set(keywords.map(getTag))).sort()

  const filtered = keywords.filter(kw => {
    const matchSearch = kw.toLowerCase().includes(search.toLowerCase()) ||
      (KW_DETAILS[kw]?.desc ?? '').toLowerCase().includes(search.toLowerCase())
    const matchTag = !filterTag || getTag(kw) === filterTag
    return matchSearch && matchTag
  })

  const detail = selected ? KW_DETAILS[selected] : null

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="w-72 flex-shrink-0 border-r border-surface-500 flex flex-col bg-surface-900">
        <div className="p-3 border-b border-surface-500 space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input pl-8 text-xs" placeholder="Search keywords..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setFilterTag(null)} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${!filterTag ? 'bg-brand-600/30 text-brand-300 border-brand-600/50' : 'text-slate-500 border-surface-500 hover:border-slate-400'}`}>
              All
            </button>
            {allTags.map(tag => (
              <button key={tag} onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${filterTag === tag ? 'bg-brand-600/30 text-brand-300 border-brand-600/50' : 'text-slate-500 border-surface-500 hover:border-slate-400'}`}>
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map(kw => (
            <button key={kw} onClick={() => setSelected(kw)}
              className={`w-full text-left px-4 py-2.5 text-xs border-b border-surface-700/50 transition-colors ${selected === kw ? 'bg-brand-600/10 text-brand-300' : 'text-slate-400 hover:bg-surface-700 hover:text-slate-200'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${tagColor[getTag(kw)] ?? ''}`}>{getTag(kw)}</span>
                <span className="font-mono truncate">{kw}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-xs text-slate-600 py-10">No keywords match</p>
          )}
        </div>

        <div className="px-4 py-2 border-t border-surface-500">
          <p className="text-xs text-slate-600">{filtered.length} of {keywords.length} keywords</p>
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto p-8">
        {selected && detail ? (
          <div className="max-w-2xl">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-brand-600/20 border border-brand-600/30 flex items-center justify-center flex-shrink-0">
                <Zap size={22} className="text-brand-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-100 font-mono">{selected}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full border mt-1 inline-block ${tagColor[getTag(selected)] ?? ''}`}>{getTag(selected)}</span>
              </div>
            </div>

            <div className="card p-5 mb-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Description</h3>
              <p className="text-sm text-slate-300 leading-relaxed">{detail.desc}</p>
            </div>

            <div className="card p-5 mb-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Parameters</h3>
              {detail.params.length === 0 ? (
                <p className="text-xs text-slate-600 italic">No parameters required</p>
              ) : (
                <div className="space-y-2">
                  {detail.params.map(p => (
                    <div key={p} className="flex items-center gap-3 py-2 border-b border-surface-500/50 last:border-0">
                      <code className="text-xs bg-surface-600 text-brand-300 px-2 py-0.5 rounded font-mono">{p}</code>
                      <span className="text-xs text-slate-500">string</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">YAML Example</h3>
              <pre className="text-xs font-mono text-green-300 bg-surface-900 rounded-lg p-4 overflow-x-auto leading-relaxed">{`- keyword: ${selected}${detail.params.length > 0 ? `\n  params:\n${detail.params.map(p => `    ${p}: "${detail.example?.includes(p) ? detail.example.split(', ').find(e => e.startsWith(p))?.split(': ')[1]?.replace(/"/g, '') ?? `{${p.toUpperCase()}}` : `{${p.toUpperCase()}}`}"`).join('\n')}` : ''}`}</pre>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-slate-600">Select a keyword to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}
