// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – CI/CD Pipeline Page
// Generate, preview and save pipeline config files for all major CI platforms.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback } from 'react'
import {
  GitBranch, Copy, Download, Save, CheckCircle2,
  Github, Container, Server, Triangle, ChevronRight,
} from 'lucide-react'
import { useAppStore, PipelineSettings } from '../store/appStore'
import api from '../lib/api'

// ── Platform descriptors ──────────────────────────────────────────────────────

type Platform = 'github' | 'azure' | 'jenkins' | 'gitlab' | 'docker'

interface PlatformDef {
  id: Platform
  label: string
  icon: React.ReactNode
  filename: string
  description: string
}

const PLATFORMS: PlatformDef[] = [
  {
    id: 'github',
    label: 'GitHub Actions',
    icon: <Github size={16} />,
    filename: '.github/workflows/prabala.yml',
    description: 'Auto-triggered on push/PR. Publishes JUnit results and HTML report as artifacts.',
  },
  {
    id: 'azure',
    label: 'Azure DevOps',
    icon: <Triangle size={16} />,
    filename: 'azure-pipelines.yml',
    description: 'Azure Pipelines YAML with JUnit result publishing and build artifact upload.',
  },
  {
    id: 'jenkins',
    label: 'Jenkins',
    icon: <Server size={16} />,
    filename: 'Jenkinsfile',
    description: 'Declarative Jenkinsfile using Playwright Docker image with HTML report publishing.',
  },
  {
    id: 'gitlab',
    label: 'GitLab CI',
    icon: <GitBranch size={16} />,
    filename: '.gitlab-ci.yml',
    description: 'GitLab CI/CD pipeline with JUnit report upload and GitLab Pages HTML report.',
  },
  {
    id: 'docker',
    label: 'Docker',
    icon: <Container size={16} />,
    filename: 'Dockerfile',
    description: 'Containerised execution image based on mcr.microsoft.com/playwright.',
  },
]

// ── YAML generators (mirrors the CLI generate-pipelines command) ───────────────

function buildRunCmd(s: PipelineSettings): string {
  const tagFlag  = s.tags.trim() ? ` --tags "${s.tags.trim()}"` : ''
  const custom   = s.runCmd.trim()
  if (custom) return custom
  return `npx prabala run tests/**/*.yaml --env ${s.env} --reporter ${s.reporter}${tagFlag}`
}

function genGitHub(s: PipelineSettings): string {
  const cmd = buildRunCmd(s)
  return `# Prabala – GitHub Actions CI
name: Prabala Tests

on:
  push:
    branches: [main, master, develop]
  pull_request:
    branches: [main, master]
  workflow_dispatch:
    inputs:
      env:
        description: 'Environment (dev/staging/prod)'
        required: false
        default: '${s.env}'
      tags:
        description: 'Tag filter (comma-separated)'
        required: false

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${s.nodeVersion}'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run Prabala tests
        run: ${cmd}
        env:
          CI: 'true'

      - name: Publish JUnit Test Results
        uses: mikepenz/action-junit-report@v4
        if: always()
        with:
          report_paths: 'artifacts/junit-results.xml'
          check_name: 'Prabala Test Results'

      - name: Upload HTML Report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: prabala-report-\${{ github.run_number }}
          path: artifacts/
          retention-days: 30
`
}

function genAzure(s: PipelineSettings): string {
  const cmd = buildRunCmd(s)
  return `# Prabala – Azure DevOps Pipeline
trigger:
  branches:
    include:
      - main
      - master
      - develop

pr:
  branches:
    include:
      - main
      - master

pool:
  vmImage: ubuntu-latest

variables:
  NODE_VERSION: '${s.nodeVersion}'

stages:
  - stage: Test
    displayName: 'Run Prabala Tests'
    jobs:
      - job: PrabalaTest
        displayName: 'Prabala Test Execution'
        timeoutInMinutes: 60
        steps:
          - task: NodeTool@0
            displayName: 'Install Node.js'
            inputs:
              versionSpec: '\$(NODE_VERSION)'

          - script: npm ci
            displayName: 'Install dependencies'

          - script: npx playwright install --with-deps chromium
            displayName: 'Install Playwright browsers'

          - script: ${cmd}
            displayName: 'Run Prabala tests'
            env:
              CI: 'true'

          - task: PublishTestResults@2
            displayName: 'Publish JUnit Results'
            condition: always()
            inputs:
              testResultsFormat: JUnit
              testResultsFiles: 'artifacts/junit-results.xml'
              testRunTitle: 'Prabala Tests - \$(Build.BuildNumber)'
              failTaskOnFailedTests: true

          - task: PublishBuildArtifacts@1
            displayName: 'Upload HTML Report'
            condition: always()
            inputs:
              PathtoPublish: 'artifacts'
              ArtifactName: 'prabala-report'
`
}

function genJenkins(s: PipelineSettings): string {
  const cmd = buildRunCmd(s)
  return `// Prabala – Jenkins Pipeline (Declarative)
pipeline {
    agent {
        docker {
            image 'mcr.microsoft.com/playwright:v1.44.0-jammy'
            args '--ipc=host'
        }
    }

    options {
        timeout(time: 60, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    environment {
        CI = 'true'
    }

    parameters {
        choice(name: 'ENV', choices: ['${s.env}', 'dev', 'staging', 'prod'], description: 'Target environment')
        string(name: 'TAGS', defaultValue: '${s.tags}', description: 'Tag filter (comma-separated)')
    }

    stages {
        stage('Install') {
            steps {
                sh 'node --version && npm --version'
                sh 'npm ci'
            }
        }

        stage('Test') {
            steps {
                sh '${cmd}'
            }
            post {
                always {
                    junit 'artifacts/junit-results.xml'
                    publishHTML(target: [
                        allowMissing: true,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: 'artifacts',
                        reportFiles: 'prabala-report.html',
                        reportName: 'Prabala HTML Report'
                    ])
                }
            }
        }
    }

    post {
        failure { echo 'Tests FAILED — check the report above' }
        success { echo 'All Prabala tests passed!' }
    }
}
`
}

function genGitLab(s: PipelineSettings): string {
  const cmd = buildRunCmd(s)
  return `# Prabala – GitLab CI/CD Pipeline
image: mcr.microsoft.com/playwright:v1.44.0-jammy

variables:
  NODE_VERSION: "${s.nodeVersion}"
  CI: "true"

stages:
  - install
  - test
  - report

cache:
  key: \${CI_COMMIT_REF_SLUG}
  paths:
    - node_modules/

install:
  stage: install
  script:
    - npm ci
  artifacts:
    paths:
      - node_modules/
    expire_in: 1 hour

test:
  stage: test
  script:
    - ${cmd}
  artifacts:
    when: always
    paths:
      - artifacts/
    expire_in: 30 days
    reports:
      junit: artifacts/junit-results.xml

pages:
  stage: report
  script:
    - mkdir -p public
    - cp artifacts/prabala-report.html public/index.html
  artifacts:
    paths:
      - public
  only:
    - main
    - master
`
}

function genDocker(s: PipelineSettings): string {
  const cmd = buildRunCmd(s)
  return `# Prabala – Docker image for CI test execution
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /workspace

# Install Node.js ${s.nodeVersion}
RUN curl -fsSL https://deb.nodesource.com/setup_${s.nodeVersion}.x | bash - && \\
    apt-get install -y nodejs

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy project files
COPY . .

# Default command: run all tests with both reporters
CMD ["sh", "-c", "${cmd}"]
`
}

function generateYaml(platform: Platform, settings: PipelineSettings): string {
  switch (platform) {
    case 'github':  return genGitHub(settings)
    case 'azure':   return genAzure(settings)
    case 'jenkins': return genJenkins(settings)
    case 'gitlab':  return genGitLab(settings)
    case 'docker':  return genDocker(settings)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const settings         = useAppStore((s) => s.pipelineSettings)
  const setPipeline      = useAppStore((s) => s.setPipelineSettings)
  const projectDir       = useAppStore((s) => s.projectDir)

  const [activePlatform, setActivePlatform] = useState<Platform>('github')
  const [copied, setCopied]                 = useState(false)
  const [saved, setSaved]                   = useState(false)
  const [saveError, setSaveError]           = useState<string | null>(null)

  const yaml = useMemo(
    () => generateYaml(activePlatform, settings),
    [activePlatform, settings],
  )

  const platformDef = PLATFORMS.find((p) => p.id === activePlatform)!

  // Copy to clipboard
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(yaml).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [yaml])

  // Download the file
  const handleDownload = useCallback(() => {
    const blob = new Blob([yaml], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = platformDef.filename.split('/').at(-1) ?? `${activePlatform}.yml`
    a.click()
    URL.revokeObjectURL(url)
  }, [yaml, platformDef, activePlatform])

  // Save all pipeline files to workspace via IPC
  const handleSaveAll = useCallback(async () => {
    if (!projectDir) { setSaveError('No workspace open'); return }
    setSaveError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ipc = api
      if (!ipc) { setSaveError('IPC not available in browser preview'); return }

      for (const p of PLATFORMS) {
        const content  = generateYaml(p.id, settings)
        const filePath = `${projectDir}/${p.filename}`
        const dir      = filePath.split('/').slice(0, -1).join('/')
        await ipc.fs.mkdir(dir)
        await ipc.fs.writeFile(filePath, content)
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setSaveError((e as Error).message)
    }
  }, [projectDir, settings])

  return (
    <div className="flex flex-col h-full text-slate-200">

      {/* Header */}
      <div className="px-6 py-4 border-b border-surface-600 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <GitBranch size={20} className="text-brand-400" />
          <div>
            <h1 className="text-lg font-semibold text-white">CI/CD Pipeline</h1>
            <p className="text-xs text-slate-500">Generate pipeline config files for your CI platform</p>
          </div>
        </div>
        <button
          onClick={handleSaveAll}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
          {saved ? 'Saved!' : 'Save all to workspace'}
        </button>
      </div>

      {saveError && (
        <div className="mx-6 mt-3 px-4 py-2 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          {saveError}
        </div>
      )}

      <div className="flex flex-1 min-h-0 gap-0">

        {/* ── Left panel: settings ─────────────────────────────────────────── */}
        <aside className="w-72 flex-shrink-0 border-r border-surface-600 overflow-y-auto p-5 space-y-6">

          {/* Run settings */}
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Run Settings</h2>
            <div className="space-y-3">

              <label className="block">
                <span className="text-xs text-slate-400 mb-1 block">Default environment</span>
                <select
                  value={settings.env}
                  onChange={(e) => setPipeline({ env: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500"
                >
                  <option value="dev">dev</option>
                  <option value="staging">staging</option>
                  <option value="prod">prod</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-slate-400 mb-1 block">Tag filter <span className="text-slate-500">(comma-separated)</span></span>
                <input
                  type="text"
                  placeholder="e.g. smoke,regression"
                  value={settings.tags}
                  onChange={(e) => setPipeline({ tags: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500"
                />
              </label>

              <label className="block">
                <span className="text-xs text-slate-400 mb-1 block">Reporter</span>
                <select
                  value={settings.reporter}
                  onChange={(e) => setPipeline({ reporter: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500"
                >
                  <option value="both">both (HTML + JUnit)</option>
                  <option value="html">html only</option>
                  <option value="junit">junit only</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-slate-400 mb-1 block">Node.js version</span>
                <select
                  value={settings.nodeVersion}
                  onChange={(e) => setPipeline({ nodeVersion: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500"
                >
                  {['18', '20', '22'].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-slate-400 mb-1 block">Custom run command <span className="text-slate-500">(optional override)</span></span>
                <input
                  type="text"
                  placeholder="Leave blank to auto-generate"
                  value={settings.runCmd}
                  onChange={(e) => setPipeline({ runCmd: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500"
                />
              </label>
            </div>
          </section>

          {/* Generated command preview */}
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Generated Command</h2>
            <div className="bg-surface-900 border border-surface-600 rounded-lg p-3 text-xs font-mono text-green-400 break-all leading-relaxed">
              {buildRunCmd(settings)}
            </div>
          </section>

          {/* Files that will be created */}
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Files to Generate</h2>
            <ul className="space-y-1">
              {PLATFORMS.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-xs">
                  <ChevronRight size={11} className="text-slate-600 flex-shrink-0" />
                  <span className="text-slate-400 font-mono">{p.filename}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        {/* ── Right panel: YAML preview ────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* Platform tabs */}
          <div className="flex border-b border-surface-600 bg-surface-800 flex-shrink-0">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePlatform(p.id)}
                title={p.description}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                  activePlatform === p.id
                    ? 'border-brand-500 text-brand-300 bg-surface-700'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-surface-700/50'
                }`}
              >
                {p.icon}
                <span className="hidden sm:inline">{p.label}</span>
              </button>
            ))}

            {/* Copy / Download buttons on the right */}
            <div className="ml-auto flex items-center gap-2 px-3">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-slate-300 rounded-lg transition-colors"
              >
                {copied ? <CheckCircle2 size={13} className="text-green-400" /> : <Copy size={13} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-slate-300 rounded-lg transition-colors"
              >
                <Download size={13} />
                Download
              </button>
            </div>
          </div>

          {/* Platform description */}
          <div className="px-5 py-2 border-b border-surface-700 flex items-center gap-2 bg-surface-800/50 flex-shrink-0">
            <span className="text-slate-500 text-xs">{platformDef.filename}</span>
            <ChevronRight size={11} className="text-slate-700" />
            <span className="text-slate-400 text-xs">{platformDef.description}</span>
          </div>

          {/* YAML content */}
          <div className="flex-1 overflow-auto bg-surface-900">
            <pre className="p-5 text-sm font-mono text-slate-300 leading-6 whitespace-pre">
              <YamlHighlight code={yaml} />
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Minimal YAML / Groovy syntax highlighter ──────────────────────────────────

function YamlHighlight({ code }: { code: string }) {
  const lines = code.split('\n')
  return (
    <>
      {lines.map((line, i) => {
        if (line.trim().startsWith('#')) {
          return <span key={i} className="text-slate-600 block">{line + '\n'}</span>
        }
        if (/^[a-zA-Z_-]+:/.test(line.trim()) || /^\s{2,}[a-zA-Z_-]+:/.test(line)) {
          const [key, ...rest] = line.split(':')
          const value = rest.join(':')
          return (
            <span key={i} className="block">
              <span className="text-blue-400">{key}</span>
              <span className="text-slate-400">:</span>
              <span className="text-amber-300">{value}</span>
              {'\n'}
            </span>
          )
        }
        if (line.trim().startsWith('-')) {
          return <span key={i} className="text-slate-300 block">{line + '\n'}</span>
        }
        return <span key={i} className="text-slate-400 block">{line + '\n'}</span>
      })}
    </>
  )
}
