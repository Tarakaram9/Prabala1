import { useEffect } from 'react'
import Layout from './components/Layout/Layout'
import TestBuilderPage from './pages/TestBuilderPage'
import KeywordLibraryPage from './pages/KeywordLibraryPage'
import ObjectRepositoryPage from './pages/ObjectRepositoryPage'
import TestDataPage from './pages/TestDataPage'
import ExecutionMonitorPage from './pages/ExecutionMonitorPage'
import ReportViewerPage from './pages/ReportViewerPage'
import { useAppStore } from './store/appStore'
import { loadProjectData } from './utils/projectLoader'

export default function App() {
  const activePage = useAppStore((s) => s.activePage)
  const projectDir = useAppStore((s) => s.projectDir)

  useEffect(() => {
    if (projectDir) loadProjectData(projectDir)
  }, [projectDir])

  const page = {
    builder:  <TestBuilderPage />,
    keywords: <KeywordLibraryPage />,
    objects:  <ObjectRepositoryPage />,
    data:     <TestDataPage />,
    monitor:  <ExecutionMonitorPage />,
    report:   <ReportViewerPage />,
  }[activePage]

  return <Layout>{page}</Layout>
}
