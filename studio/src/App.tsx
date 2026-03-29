import { useEffect } from 'react'
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
import CustomKeywordsPage from './pages/CustomKeywordsPage'
import SchedulerPage from './pages/SchedulerPage'
import { useAppStore } from './store/appStore'
import { loadProjectData } from './utils/projectLoader'

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
    builder:          <TestBuilderPage />,
    keywords:         <KeywordLibraryPage />,
    objects:          <ObjectRepositoryPage />,
    components:       <ComponentsPage />,
    data:             <TestDataPage />,
    monitor:          <ExecutionMonitorPage />,
    report:           <ReportViewerPage />,
    ai:               <AIPage />,
    pipeline:         <PipelinePage />,
    dashboard:        <DashboardPage />,
    gherkin:          <GherkinPage />,
    'custom-keywords': <CustomKeywordsPage />,
    scheduler:        <SchedulerPage />,
  }[activePage]

  return <Layout>{page}</Layout>
}
