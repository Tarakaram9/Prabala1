// ─────────────────────────────────────────────────────────────────────────────
// Prabala Reporting – HTML Reporter
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { SuiteResult, TestResult, StepResult } from '@prabala/core';

export class HtmlReporter {
  private outputDir: string;

  constructor(outputDir: string = 'artifacts') {
    this.outputDir = outputDir;
    fs.mkdirSync(outputDir, { recursive: true });
  }

  generate(suite: SuiteResult): string {
    const html = this.buildHtml(suite);
    const reportPath = path.join(this.outputDir, 'prabala-report.html');
    fs.writeFileSync(reportPath, html, 'utf-8');
    return reportPath;
  }

  private buildHtml(suite: SuiteResult): string {
    const passRate =
      suite.passed + suite.failed > 0
        ? Math.round((suite.passed / (suite.passed + suite.failed)) * 100)
        : 0;

    const testsHtml = suite.tests.map((t) => this.buildTestHtml(t)).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prabala Test Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #0f0f15; color: #e0e0e0; }
    header { background: linear-gradient(135deg, #6c2bd9, #3b82f6);
             padding: 24px 32px; }
    header h1 { font-size: 28px; color: #fff; letter-spacing: 1px; }
    header p { color: rgba(255,255,255,0.7); margin-top: 4px; font-size: 13px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
               padding: 24px 32px; max-width: 1200px; margin: 0 auto; }
    .card { background: #1a1a2e; border-radius: 12px; padding: 20px;
            border: 1px solid #2a2a4a; }
    .card h2 { font-size: 32px; font-weight: 700; }
    .card p { font-size: 12px; color: #888; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
    .passed { color: #22c55e; }
    .failed { color: #ef4444; }
    .skipped { color: #f59e0b; }
    .neutral { color: #3b82f6; }
    .tests { padding: 0 32px 32px; max-width: 1200px; margin: 0 auto; }
    .test-card { background: #1a1a2e; border-radius: 10px; margin-bottom: 12px;
                 border: 1px solid #2a2a4a; overflow: hidden; }
    .test-header { padding: 14px 20px; display: flex; align-items: center;
                   justify-content: space-between; cursor: pointer; }
    .test-header:hover { background: #22224e; }
    .test-name { font-weight: 600; font-size: 15px; }
    .badge { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 100px;
             text-transform: uppercase; }
    .badge.passed { background: #052e16; color: #22c55e; border: 1px solid #166534; }
    .badge.failed { background: #2d0a0a; color: #ef4444; border: 1px solid #7f1d1d; }
    .steps { padding: 0 20px 16px; }
    .step { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0;
            border-bottom: 1px solid #2a2a4a; font-size: 13px; }
    .step:last-child { border-bottom: none; }
    .step-icon { font-size: 14px; margin-top: 1px; }
    .step-kw { font-weight: 600; color: #93c5fd; }
    .step-err { color: #fca5a5; font-size: 12px; margin-top: 2px; }
    .step-dur { color: #6b7280; font-size: 11px; margin-left: auto; white-space: nowrap; }
    .progress-bar { height: 4px; background: #2a2a4a; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #22c55e, #3b82f6);
                     transition: width 0.3s; }
    .step-screenshot { margin-top: 6px; }
    .step-screenshot summary { font-size: 11px; color: #6b7280; cursor: pointer;
                               list-style: none; user-select: none; }
    .step-screenshot summary::-webkit-details-marker { display: none; }
    .step-screenshot img { max-width: 100%; border-radius: 6px; margin-top: 6px;
                           border: 1px solid #2a2a4a; cursor: zoom-in; display: block; }
    details > summary { list-style: none; }
    details > summary::-webkit-details-marker { display: none; }
  </style>
</head>
<body>
  <header>
    <h1>🔮 Prabala Test Report</h1>
    <p>${suite.suite} &nbsp;|&nbsp; ${new Date(suite.startTime).toLocaleString()} &nbsp;|&nbsp; ${suite.totalDurationMs}ms total</p>
  </header>

  <div class="progress-bar">
    <div class="progress-fill" style="width: ${passRate}%"></div>
  </div>

  <div class="summary">
    <div class="card">
      <h2 class="${suite.failed === 0 ? 'passed' : 'failed'}">${passRate}%</h2>
      <p>Pass Rate</p>
    </div>
    <div class="card">
      <h2 class="passed">${suite.passed}</h2>
      <p>Passed</p>
    </div>
    <div class="card">
      <h2 class="failed">${suite.failed}</h2>
      <p>Failed</p>
    </div>
    <div class="card">
      <h2 class="neutral">${suite.tests.length}</h2>
      <p>Total Tests</p>
    </div>
  </div>

  <div class="tests">
    <h3 style="margin-bottom: 16px; color: #888; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Test Cases</h3>
    ${testsHtml}
  </div>
</body>
</html>`;
  }

  private buildTestHtml(test: TestResult): string {
    const stepsHtml = test.steps
      .map((s) => this.buildStepHtml(s))
      .join('\n');

    return `
    <details class="test-card">
      <summary class="test-header">
        <span class="test-name">${this.escape(test.testCase)}</span>
        <div style="display:flex;gap:12px;align-items:center">
          <span style="color:#6b7280;font-size:12px">${test.durationMs}ms</span>
          <span class="badge ${test.status}">${test.status}</span>
        </div>
      </summary>
      <div class="steps">
        ${stepsHtml}
      </div>
    </details>`;
  }

  private buildStepHtml(step: StepResult): string {
    const icon = step.status === 'passed' ? '✔' : step.status === 'failed' ? '✘' : '–';
    const screenshotHtml = step.screenshot
      ? `<details class="step-screenshot">
           <summary>📷 Screenshot</summary>
           <img src="${step.screenshot}" alt="step screenshot" />
         </details>`
      : '';
    return `
        <div class="step">
          <span class="step-icon ${step.status}">${icon}</span>
          <div style="flex:1">
            <span class="step-kw">${this.escape(step.keyword)}</span>
            ${step.error ? `<div class="step-err">${this.escape(step.error)}</div>` : ''}
            ${screenshotHtml}
          </div>
          <span class="step-dur">${step.durationMs}ms</span>
        </div>`;
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
