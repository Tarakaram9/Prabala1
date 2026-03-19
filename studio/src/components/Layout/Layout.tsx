import { ReactNode } from 'react'
import Sidebar from './Sidebar'
import Titlebar from './Titlebar'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-screen bg-surface-900 overflow-hidden">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden bg-surface-800">
          {children}
        </main>
      </div>
    </div>
  )
}
