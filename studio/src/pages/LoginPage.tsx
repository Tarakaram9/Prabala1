import { useState, FormEvent } from 'react'
import { useAppStore } from '../store/appStore'
import { Sparkles, Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const login = useAppStore((s) => s.login)
  const loginError = useAppStore((s) => s.loginError)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [shaking, setShaking] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const ok = login(username.trim(), password)
    if (!ok) {
      setShaking(true)
      setTimeout(() => setShaking(false), 500)
    }
  }

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-brand-500/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-0 w-64 h-64 bg-brand-700/6 rounded-full blur-2xl" />
        {/* Grid pattern */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Login card */}
      <div className={`relative z-10 w-full max-w-sm mx-4 transition-all ${shaking ? 'animate-shake' : ''}`}>
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 mb-4 shadow-lg shadow-brand-900/50">
            <Sparkles size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Prabala Studio</h1>
          <p className="text-slate-500 text-sm mt-1">Intelligent Test Automation Platform</p>
        </div>

        {/* Card */}
        <div className="bg-surface-800/80 border border-surface-500/60 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-slate-200 mb-6">Sign in to your workspace</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Username</label>
              <input
                type="text"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="input w-full text-sm"
                placeholder="Enter username"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input w-full text-sm pr-10"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {loginError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-950/50 border border-red-800/50">
                <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-300">{loginError}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!username.trim() || !password}
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <LogIn size={15} />
              Sign In
            </button>
          </form>

          {/* hint */}
          <p className="text-center text-xs text-slate-600 mt-5">
            Default: <span className="font-mono text-slate-500">admin</span> / <span className="font-mono text-slate-500">admin123</span>
          </p>
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          Prabala Studio v0.1 · Apache 2.0 · Open Source
        </p>
      </div>
    </div>
  )
}
