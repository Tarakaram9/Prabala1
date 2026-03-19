// ─────────────────────────────────────────────────────────────────────────────
// Project Loader – reads YAML test cases & object repos from disk
// ─────────────────────────────────────────────────────────────────────────────

import yaml from 'js-yaml'
import { useAppStore, TestCase, TestStep, ObjectEntry } from '../store/appStore'

const ipc = (window as any).prabala

function isElectron(): boolean {
  return typeof (window as any).prabala !== 'undefined'
}

// ── Load all test cases from tests/ ─────────────────────────────────────────
export async function loadProjectData(projectDir: string): Promise<void> {
  if (!isElectron()) {
    loadMockData()
    return
  }

  try {
    // Load test cases
    const testCases = await loadTestCases(projectDir)
    useAppStore.getState().setTestCases(testCases)
    if (testCases.length > 0) {
      useAppStore.getState().setActiveTestCase(testCases[0])
    }

    // Load object repository
    const objects = await loadObjectRepository(projectDir)
    useAppStore.getState().setObjects(objects)

    // Fetch keyword list from CLI
    const keywords = await fetchKeywords(projectDir)
    useAppStore.getState().setKeywords(keywords)

  } catch (err) {
    console.error('Error loading project:', err)
    loadMockData()
  }
}

async function loadTestCases(projectDir: string): Promise<TestCase[]> {
  const testsDir = `${projectDir}/tests`
  const cases: TestCase[] = []

  async function scanDir(dir: string): Promise<void> {
    const entries: { name: string; isDir: boolean; path: string }[] =
      await ipc.fs.readDir(dir)
    for (const entry of entries) {
      if (entry.isDir) {
        await scanDir(entry.path)
      } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
        try {
          const content: string = await ipc.fs.readFile(entry.path)
          const parsed = yaml.load(content) as any
          if (parsed?.testCase) {
            cases.push({
              id: entry.path,
              filePath: entry.path,
              testCase: parsed.testCase,
              tags: parsed.tags ?? [],
              description: parsed.description ?? '',
              steps: (parsed.steps ?? []).map((s: any, i: number): TestStep => ({
                id: `${entry.path}-step-${i}`,
                keyword: s.keyword,
                params: s.params ?? {},
                description: s.description ?? '',
                continueOnFailure: s.continueOnFailure ?? false,
              })),
              isDirty: false,
            })
          }
        } catch {}
      }
    }
  }

  const exists: boolean = await ipc.fs.exists(testsDir)
  if (exists) await scanDir(testsDir)
  return cases
}

async function loadObjectRepository(projectDir: string): Promise<ObjectEntry[]> {
  const objDir = `${projectDir}/object-repository`
  const objects: ObjectEntry[] = []
  const exists: boolean = await ipc.fs.exists(objDir)
  if (!exists) return objects

  const entries: { name: string; isDir: boolean; path: string }[] =
    await ipc.fs.readDir(objDir)

  for (const entry of entries) {
    if (!entry.isDir && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      const content: string = await ipc.fs.readFile(entry.path)
      const parsed = yaml.load(content) as any
      if (parsed?.objects) {
        for (const [key, val] of Object.entries(parsed.objects as Record<string, any>)) {
          objects.push({ key, strategy: val.strategy, locator: val.locator, description: val.description, page: entry.name.replace(/\.ya?ml$/, '') })
        }
      }
    }
  }
  return objects
}

async function fetchKeywords(projectDir: string): Promise<string[]> {
  // Keywords embedded — same list as the CLI
  return [
    'Web.Launch','Web.Close','NavigateTo','GoBack','Reload',
    'Click','DoubleClick','RightClick','EnterText','PressKey',
    'SelectOption','Hover','ScrollTo','Check','Uncheck','UploadFile',
    'WaitForVisible','WaitForHidden','WaitForNavigation','Wait',
    'AssertVisible','AssertNotVisible','AssertText','AssertTitle',
    'AssertUrl','AssertEnabled','AssertValue',
    'GetText','GetValue','TakeScreenshot',
    'AcceptAlert','DismissAlert','SwitchToFrame',
    'API.GET','API.POST','API.AssertStatus','API.AssertBody',
    'Desktop.LaunchApp','Desktop.Click','Desktop.EnterText',
    'Desktop.AssertVisible','Desktop.CloseApp',
  ].sort()
}

// ── Mock data for browser preview (non-Electron) ────────────────────────────
function loadMockData(): void {
  const mockSteps: TestStep[] = [
    { id: 's1', keyword: 'Web.Launch', params: {}, description: 'Open browser' },
    { id: 's2', keyword: 'NavigateTo', params: { url: '{BASE_URL}' }, description: 'Go to app' },
    { id: 's3', keyword: 'WaitForVisible', params: { locator: '@todo-input' }, description: 'Wait for input' },
    { id: 's4', keyword: 'EnterText', params: { locator: '@todo-input', value: '{TEST_DATA.todoItem1}' }, description: 'Enter todo text' },
    { id: 's5', keyword: 'PressKey', params: { key: 'Enter' }, description: 'Submit todo' },
    { id: 's6', keyword: 'AssertVisible', params: { locator: '@first-todo-label' }, description: 'Verify todo appears' },
    { id: 's7', keyword: 'TakeScreenshot', params: { name: 'add-todo-success' }, description: 'Capture screenshot' },
    { id: 's8', keyword: 'Web.Close', params: {}, description: 'Close browser' },
  ]

  const mockCases: TestCase[] = [
    {
      id: 'demo-1',
      filePath: '/Users/ram/prabala/tests/todo/add-todo.yaml',
      testCase: 'Add a new todo item',
      tags: ['smoke', 'todo'],
      description: 'Verify a user can add a new todo item',
      steps: mockSteps,
      isDirty: false,
    },
    {
      id: 'demo-2',
      filePath: '/Users/ram/prabala/tests/todo/complete-todo.yaml',
      testCase: 'Complete a todo item and filter by completed',
      tags: ['regression', 'todo'],
      description: 'Mark todo complete and verify filter',
      steps: mockSteps.slice(0, 5),
      isDirty: false,
    },
  ]

  const mockObjects: ObjectEntry[] = [
    { key: 'todo-input', strategy: 'css', locator: '.new-todo', description: 'Main todo input', page: 'todomvc' },
    { key: 'todo-list', strategy: 'css', locator: '.todo-list', description: 'Todo list container', page: 'todomvc' },
    { key: 'first-todo-label', strategy: 'css', locator: '.todo-list li:first-child label', description: 'First todo label', page: 'todomvc' },
    { key: 'first-todo-checkbox', strategy: 'css', locator: '.todo-list li:first-child .toggle', description: 'First todo checkbox', page: 'todomvc' },
    { key: 'filter-completed', strategy: 'css', locator: "a[href='#/completed']", description: 'Completed filter', page: 'todomvc' },
    { key: 'clear-completed-btn', strategy: 'text', locator: 'Clear completed', description: 'Clear completed button', page: 'todomvc' },
  ]

  useAppStore.getState().setTestCases(mockCases)
  useAppStore.getState().setActiveTestCase(mockCases[0])
  useAppStore.getState().setObjects(mockObjects)
  useAppStore.getState().setKeywords([
    'Web.Launch','Web.Close','NavigateTo','GoBack','Reload',
    'Click','DoubleClick','RightClick','EnterText','PressKey',
    'SelectOption','Hover','ScrollTo','Check','Uncheck','UploadFile',
    'WaitForVisible','WaitForHidden','WaitForNavigation','Wait',
    'AssertVisible','AssertNotVisible','AssertText','AssertTitle',
    'AssertUrl','AssertEnabled','AssertValue',
    'GetText','GetValue','TakeScreenshot',
    'AcceptAlert','DismissAlert','SwitchToFrame',
    'API.GET','API.POST','API.AssertStatus','API.AssertBody',
    'Desktop.LaunchApp','Desktop.Click','Desktop.EnterText',
    'Desktop.AssertVisible','Desktop.CloseApp',
  ].sort())
}
