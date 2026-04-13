import { useEffect, Component, ReactNode } from 'react'
import Layout from './components/Layout/Layout'
import TestBuilderPage from './pages/TestBuilderPage'
import KeywordLibraryPage from './pages/KeywordLibraryPage'
import ObjectRepositoryPage from './pages/ObjectRepositoryPage'
import ComponentsPage from './pages/ComponentsPage'
import TestDataPage from './pages/TestDataPage'
import ExecutionMonitorPage from './pages/ExecutionMonitorPage'
import ReportViewerPage from './pages/ReportViewerPage'
import AIPage from './pages/AIPage'
import PipelinePage from './pages/PipelinePage'
import LoginPage from './pages/LoginPage'
import WorkspacePage from './pages/WorkspacePage'
import DashboardPage from './pages/DashboardPage'
import GherkinPage from './pages/GherkinPage'
import RequirementsPage from './pages/RequirementsPage'
import CustomKeywordsPage from './pages/CustomKeywordsPage'
import SchedulerPage from './pages/SchedulerPage'
import ProjectSettingsPage from './pages/ProjectSettingsPage'
import { useAppStore } from './store/appStore'
import { loadProjectData } from './utils/projectLoader'

// ── Page-level error boundary ─────────────────────────────────────────────────
class PageErrorBoundary extends Component<
  { children: ReactNode; pageName: string },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode; pageName: string }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }
  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-red-400 font-medium">Something went wrong in {this.props.pageName}</p>
          <pre className="text-xs text-slate-400 bg-surface-700 rounded-lg px-4 py-3 max-w-lg overflow-auto whitespace-pre-wrap">
            {this.state.message}
          </pre>
          <button
            className="btn-secondary text-xs"
            onClick={() => this.setState({ hasError: false, message: '' })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const activePage = useAppStore((s) => s.activePage)
  const projectDir = useAppStore((s) => s.projectDir)
  const currentUser = useAppStore((s) => s.currentUser)
  const workspace = useAppStore((s) => s.workspace)

  useEffect(() => {
    if (projectDir) loadProjectData(projectDir)
  }, [projectDir])

  // 1. Not logged in → show Login
  if (!currentUser) return <LoginPage />

  // 2. Logged in but no workspace selected → show Workspace picker
  if (!workspace) return <WorkspacePage />

  // 3. Fully authenticated with workspace → show main Studio
  const page = {
    builder:          <PageErrorBoundary pageName="Test Builder"><TestBuilderPage /></PageErrorBoundary>,
    keywords:         <PageErrorBoundary pageName="Keywords"><KeywordLibraryPage /></PageErrorBoundary>,
    objects:          <PageErrorBoundary pageName="Object Repository"><ObjectRepositoryPage /></PageErrorBoundary>,
    components:       <PageErrorBoundary pageName="Components"><ComponentsPage /></PageErrorBoundary>,
    data:             <PageErrorBoundary pageName="Test Data"><TestDataPage /></PageErrorBoundary>,
    monitor:          <PageErrorBoundary pageName="Run Tests"><ExecutionMonitorPage /></PageErrorBoundary>,
    report:           <PageErrorBoundary pageName="Reports"><ReportViewerPage /></PageErrorBoundary>,
    ai:               <PageErrorBoundary pageName="AI Co-Pilot"><AIPage /></PageErrorBoundary>,
    pipeline:         <PageErrorBoundary pageName="CI/CD Pipeline"><PipelinePage /></PageErrorBoundary>,
    dashboard:        <PageErrorBoundary pageName="Dashboard"><DashboardPage /></PageErrorBoundary>,
    gherkin:          <PageErrorBoundary pageName="BDD / Gherkin"><GherkinPage /></PageErrorBoundary>,
    requirements:     <PageErrorBoundary pageName="Requirements"><RequirementsPage /></PageErrorBoundary>,
    'custom-keywords': <PageErrorBoundary pageName="Custom Keywords"><CustomKeywordsPage /></PageErrorBoundary>,
    scheduler:        <PageErrorBoundary pageName="Scheduler"><SchedulerPage /></PageErrorBoundary>,
    settings:         <PageErrorBoundary pageName="Project Settings"><ProjectSettingsPage /></PageErrorBoundary>,
  }[activePage]

  return <Layout>{page}</Layout>
}
