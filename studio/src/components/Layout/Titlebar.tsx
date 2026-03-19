import { Minus, Square, X } from 'lucide-react'

export default function Titlebar() {
  return (
    <div className="titlebar-drag h-9 flex items-center justify-between bg-surface-900 border-b border-surface-500 flex-shrink-0 px-4">
      {/* macOS traffic lights space */}
      <div className="w-16" />

      <p className="text-xs text-slate-500 font-medium tracking-wide">Prabala Studio</p>

      {/* Windows-style controls (hidden on macOS) */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <span className="text-xs text-slate-600 font-mono">v0.1.0</span>
      </div>
    </div>
  )
}
